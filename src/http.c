// ===========================================================================
// HTTP-клиент для игрового API ($.http).
//
// Два бэкенда, выбираются при сборке (см. http.h):
//   * libcurl — неблокирующий curl_multi, умеет http и https (обычный случай);
//   * встроенный сокетный — только http://, аварийный режим без libcurl.
//
// Оба не держат игровой цикл: r2d_http_request() лишь ставит запись в очередь,
// r2d_http_update() продвигает её каждый кадр. Готовый результат ждёт в записи,
// пока его не заберёт r2d_http_poll(); r2d_http_cancel() освобождает запись
// немедленно. Запись никогда не исчезает молча: при любой ошибке (невалидный
// URL, нет соединения, таймаут) результат помечается done с текстом ошибки —
// иначе Promise в игре завис бы навсегда.
// ===========================================================================

#include "http.h"
#include "r2d.h"

#include <quickjs.h>

#include <ctype.h>
#include <errno.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>

#if defined(R2D_ENABLE_HTTP) && defined(R2D_HTTP_WITH_CURL)
#  define R2D_HTTP_CURL 1
#elif defined(R2D_ENABLE_HTTP)
#  define R2D_HTTP_SOCKET 1
#endif

#ifdef _WIN32
// WIN32_LEAN_AND_MEAN — чтобы windows.h не тянул winsock.h: он конфликтует
// с winsock2.h, который подключает сокетный бэкенд.
#  ifndef WIN32_LEAN_AND_MEAN
#    define WIN32_LEAN_AND_MEAN
#  endif
#  include <windows.h>
#endif

#ifdef R2D_HTTP_CURL
#  include <curl/curl.h>
#endif

#ifdef R2D_HTTP_SOCKET
#  ifdef _WIN32
#    include <winsock2.h>
#    include <ws2tcpip.h>
#    define R2D_SOCK_CLOSE closesocket
#    define R2D_SOCK_INVALID INVALID_SOCKET
typedef SOCKET r2d_socket_t;
typedef int    r2d_socklen_t;
#  else
#    include <arpa/inet.h>
#    include <fcntl.h>
#    include <netdb.h>
#    include <netinet/in.h>
#    include <sys/select.h>
#    include <sys/socket.h>
#    include <unistd.h>
#    define R2D_SOCK_CLOSE close
#    define R2D_SOCK_INVALID (-1)
typedef int r2d_socket_t;
typedef socklen_t r2d_socklen_t;
#  endif
#endif

// Сколько запросов может висеть одновременно. Игре хватает с запасом; запись
// освобождается в poll/cancel, поэтому лимит — только про «забытые» запросы.
#define R2D_HTTP_MAX 64

// Таймаут по умолчанию, если игра не задала свой (мс).
#define R2D_HTTP_DEFAULT_TIMEOUT_MS 15000.0

// Предел размера ответа для сокетного бэкенда: защита от бесконечного потока
// и от роста памяти, которым управляет удалённый сервер.
#define R2D_HTTP_MAX_RESPONSE (64u * 1024u * 1024u)

// ===========================================================================
// Время и память
// ===========================================================================

// Монотонные миллисекунды: нужны для timeMs и для таймаута сокетного бэкенда.
static double r2d__now_ms(void)
{
#ifdef _WIN32
    return (double)GetTickCount64();
#else
    struct timespec ts;
    clock_gettime(CLOCK_MONOTONIC, &ts);
    return (double)ts.tv_sec * 1000.0 + (double)ts.tv_nsec / 1e6;
#endif
}

static char *r2d__strdup(const char *s)
{
    if (!s) return NULL;
    const size_t n = strlen(s) + 1;
    char *p = (char *)malloc(n);
    if (p) memcpy(p, s, n);
    return p;
}

// Сравнение префикса URL без учёта регистра: "HTTP://" — тоже http.
static bool r2d__starts_with_ci(const char *s, const char *prefix)
{
    for (size_t i = 0; prefix[i]; ++i) {
        if (!s[i]) return false;
        if (tolower((unsigned char)s[i]) != tolower((unsigned char)prefix[i])) return false;
    }
    return true;
}

// ===========================================================================
// Растущий буфер: тело ответа, сырые заголовки, сокетный запрос.
// ===========================================================================

typedef struct R2DBuf {
    char  *data;
    size_t len;
    size_t cap;
} R2DBuf;

static bool r2d__buf_reserve(R2DBuf *b, size_t extra)
{
    if (b->len + extra <= b->cap) return true;
    size_t cap = b->cap ? b->cap : 256;
    while (cap < b->len + extra) cap *= 2;
    char *p = (char *)realloc(b->data, cap);
    if (!p) return false;
    b->data = p;
    b->cap = cap;
    return true;
}

static bool r2d__buf_append(R2DBuf *b, const void *p, size_t n)
{
    if (n == 0) return true;
    if (!r2d__buf_reserve(b, n)) return false;
    memcpy(b->data + b->len, p, n);
    b->len += n;
    return true;
}

#if defined(R2D_HTTP_CURL) || defined(R2D_HTTP_SOCKET)
static bool r2d__buf_puts(R2DBuf *b, const char *s)
{
    return s ? r2d__buf_append(b, s, strlen(s)) : true;
}
#endif

// Забрать содержимое как C-строку (с завершающим NUL). Буфер обнуляется.
static char *r2d__buf_take(R2DBuf *b)
{
    if (!b->data) return NULL;
    if (!r2d__buf_reserve(b, 1)) { free(b->data); b->data = NULL; b->len = b->cap = 0; return NULL; }
    b->data[b->len] = '\0';
    char *out = b->data;
    b->data = NULL;
    b->len = b->cap = 0;
    return out;
}

static void r2d__buf_free(R2DBuf *b)
{
    free(b->data);
    b->data = NULL;
    b->len = b->cap = 0;
}

// ===========================================================================
// Записи запросов
// ===========================================================================

#ifdef R2D_HTTP_SOCKET
typedef enum {
    R2D_SOCK_CONNECT = 0,
    R2D_SOCK_SEND,
    R2D_SOCK_RECV,
} R2DSockState;
#endif

typedef struct R2DHttpEntry {
    bool         used;
    bool         done;
    int          id;
    R2DHttpResult res;

    R2DBuf       body;      // накопитель тела ответа
    R2DBuf       headers;   // накопитель сырых заголовков

    double       start_ms;
    double       timeout_ms;

#ifdef R2D_HTTP_CURL
    CURL              *easy;
    struct curl_slist *hdrs;
    char              *req_body;   // тело держим живым: CURLOPT_POSTFIELDS не копирует
    char               errbuf[CURL_ERROR_SIZE];
#elif defined(R2D_HTTP_SOCKET)
    r2d_socket_t fd;
    R2DSockState state;
    char        *host;
    int          port;
    char        *path;
    R2DBuf       request;   // байты запроса целиком
    size_t       sent;
    R2DBuf       raw;       // весь ответ до закрытия соединения
#endif
} R2DHttpEntry;

static R2DHttpEntry g_entries[R2D_HTTP_MAX];
static int          g_next_id = 1;
static bool         g_ready = false;

#if defined(R2D_HTTP_SOCKET) && defined(_WIN32)
static bool g_wsa_started = false;
#endif

#ifdef R2D_HTTP_CURL
static CURLM *g_multi = NULL;
static bool   g_curl_inited = false;
#endif

static R2DHttpEntry *r2d__entry_find(int id)
{
    for (int i = 0; i < R2D_HTTP_MAX; ++i) {
        if (g_entries[i].used && g_entries[i].id == id) return &g_entries[i];
    }
    return NULL;
}

// Освободить ресурсы бэкенда записи (не сам слот).
static void r2d__entry_release_backend(R2DHttpEntry *e)
{
#ifdef R2D_HTTP_CURL
    if (e->easy) {
        if (g_multi) curl_multi_remove_handle(g_multi, e->easy);
        curl_easy_cleanup(e->easy);
        e->easy = NULL;
    }
    if (e->hdrs) { curl_slist_free_all(e->hdrs); e->hdrs = NULL; }
    free(e->req_body);
    e->req_body = NULL;
#elif defined(R2D_HTTP_SOCKET)
    if (e->fd != R2D_SOCK_INVALID) {
        R2D_SOCK_CLOSE(e->fd);
        e->fd = R2D_SOCK_INVALID;
    }
    free(e->host); e->host = NULL;
    free(e->path); e->path = NULL;
    r2d__buf_free(&e->request);
    r2d__buf_free(&e->raw);
#else
    R2D_UNUSED(e);
#endif
}

static void r2d__entry_clear(R2DHttpEntry *e)
{
    r2d__entry_release_backend(e);
    free(e->res.body);
    free(e->res.headers);
    free(e->res.error);
    r2d__buf_free(&e->body);
    r2d__buf_free(&e->headers);
    memset(e, 0, sizeof(*e));
    e->id = 0;
#ifdef R2D_HTTP_SOCKET
    e->fd = R2D_SOCK_INVALID;
#endif
}

static R2DHttpEntry *r2d__entry_new(void)
{
    for (int i = 0; i < R2D_HTTP_MAX; ++i) {
        if (g_entries[i].used) continue;
        R2DHttpEntry *e = &g_entries[i];
        memset(e, 0, sizeof(*e));
        e->used = true;
        e->id = g_next_id++;
        e->start_ms = r2d__now_ms();
#ifdef R2D_HTTP_SOCKET
        e->fd = R2D_SOCK_INVALID;
#endif
        return e;
    }
    return NULL;
}

// Отметить запись неудачной: статус 0, текст ошибки, done. Так игра всегда
// получит reject, а не вечно висящий Promise.
static void r2d__entry_fail(R2DHttpEntry *e, const char *msg)
{
    if (e->done) return;
    // Длину тела запоминаем до take: иначе на ошибке частично принятое тело
    // возвращалось в JS пустой строкой (body_len оставался нулевым).
    const size_t body_len = e->body.len;
    e->res.status = 0;
    free(e->res.error);
    e->res.error = r2d__strdup(msg ? msg : "неизвестная ошибка");
    e->res.body = r2d__buf_take(&e->body);
    e->res.body_len = e->res.body ? body_len : 0;
    e->res.headers = r2d__buf_take(&e->headers);
    e->res.time_ms = r2d__now_ms() - e->start_ms;
    e->done = true;
    r2d__entry_release_backend(e);
}

static void r2d__entry_done(R2DHttpEntry *e, long status)
{
    if (e->done) return;
    const size_t body_len = e->body.len;   // длину берём до take: тело может быть бинарным
    e->res.status = status;
    e->res.body = r2d__buf_take(&e->body);
    e->res.body_len = e->res.body ? body_len : 0;
    e->res.headers = r2d__buf_take(&e->headers);
    e->res.time_ms = r2d__now_ms() - e->start_ms;
    e->done = true;
    r2d__entry_release_backend(e);
}

// ===========================================================================
// Бэкенд libcurl
// ===========================================================================

#ifdef R2D_HTTP_CURL

static size_t r2d__curl_write_cb(char *ptr, size_t size, size_t nmemb, void *userdata)
{
    R2DBuf *b = (R2DBuf *)userdata;
    const size_t n = size * nmemb;
    return r2d__buf_append(b, ptr, n) ? n : 0;
}

static size_t r2d__curl_header_cb(char *ptr, size_t size, size_t nmemb, void *userdata)
{
    R2DBuf *b = (R2DBuf *)userdata;
    const size_t n = size * nmemb;
    return r2d__buf_append(b, ptr, n) ? n : 0;
}

// Понятный русский текст вместо кода curl: игра показывает его напрямую.
static const char *r2d__curl_error_ru(CURLcode code)
{
    switch (code) {
    case CURLE_COULDNT_RESOLVE_HOST: return "не удалось разрешить имя хоста";
    case CURLE_COULDNT_RESOLVE_PROXY: return "не удалось разрешить прокси";
    case CURLE_COULDNT_CONNECT:      return "не удалось подключиться к серверу";
    case CURLE_OPERATION_TIMEDOUT:   return "таймаут запроса";
    case CURLE_TOO_MANY_REDIRECTS:   return "слишком много перенаправлений";
    case CURLE_SSL_CONNECT_ERROR:    return "ошибка защищённого соединения (TLS)";
    case CURLE_PEER_FAILED_VERIFICATION: return "сертификат сервера не прошёл проверку";
    case CURLE_URL_MALFORMAT:        return "невалидный URL";
    case CURLE_UNSUPPORTED_PROTOCOL: return "протокол не поддерживается";
    case CURLE_GOT_NOTHING:          return "сервер закрыл соединение без ответа";
    case CURLE_SEND_ERROR:           return "ошибка отправки запроса";
    case CURLE_RECV_ERROR:           return "ошибка чтения ответа";
    case CURLE_WRITE_ERROR:          return "не удалось сохранить ответ";
    default:                         return "ошибка сети";
    }
}

static void r2d__curl_finish(R2DHttpEntry *e, CURLcode code)
{
    long status = 0;
    curl_easy_getinfo(e->easy, CURLINFO_RESPONSE_CODE, &status);

    if (code != CURLE_OK) {
        char msg[512];
        const char *tail = (e->errbuf[0] != '\0') ? e->errbuf : curl_easy_strerror(code);
        snprintf(msg, sizeof msg, "%s: %s", r2d__curl_error_ru(code), tail ? tail : "");
        // Переносим уже прочитанное тело/заголовки в результат до fail().
        r2d__entry_fail(e, msg);
        return;
    }
    if (status <= 0) {
        r2d__entry_fail(e, "сервер не вернул HTTP-статус");
        return;
    }
    r2d__entry_done(e, status);
}

static bool r2d__curl_start(R2DHttpEntry *e, const char *method, const char *url,
                            const char *body,
                            const char *const *names, const char *const *values,
                            int header_count, double timeout_ms)
{
    CURL *easy = curl_easy_init();
    if (!easy) return false;

    e->easy = easy;
    e->req_body = r2d__strdup(body);   // CURLOPT_POSTFIELDS не копирует — держим сами
    e->errbuf[0] = '\0';

    for (int i = 0; i < header_count; ++i) {
        if (!names[i] || !values[i]) continue;
        R2DBuf line = {0};
        r2d__buf_puts(&line, names[i]);
        r2d__buf_puts(&line, ": ");
        r2d__buf_puts(&line, values[i]);
        char *text = r2d__buf_take(&line);
        if (text) {
            struct curl_slist *next = curl_slist_append(e->hdrs, text);
            free(text);
            if (!next) return false;
            e->hdrs = next;
        }
    }

    const long timeout = (long)(timeout_ms > 0 ? timeout_ms : R2D_HTTP_DEFAULT_TIMEOUT_MS);

    curl_easy_setopt(easy, CURLOPT_URL, url);
    curl_easy_setopt(easy, CURLOPT_WRITEFUNCTION, r2d__curl_write_cb);
    curl_easy_setopt(easy, CURLOPT_WRITEDATA, &e->body);
    curl_easy_setopt(easy, CURLOPT_HEADERFUNCTION, r2d__curl_header_cb);
    curl_easy_setopt(easy, CURLOPT_HEADERDATA, &e->headers);
    curl_easy_setopt(easy, CURLOPT_ERRORBUFFER, e->errbuf);
    curl_easy_setopt(easy, CURLOPT_NOSIGNAL, 1L);
    curl_easy_setopt(easy, CURLOPT_FOLLOWLOCATION, 1L);
    curl_easy_setopt(easy, CURLOPT_MAXREDIRS, 5L);
    curl_easy_setopt(easy, CURLOPT_TIMEOUT_MS, timeout);
    curl_easy_setopt(easy, CURLOPT_CONNECTTIMEOUT_MS, timeout);
    curl_easy_setopt(easy, CURLOPT_ACCEPT_ENCODING, "");
    curl_easy_setopt(easy, CURLOPT_USERAGENT, "russiano2d/" R2D_VERSION_STRING);
    if (e->hdrs) curl_easy_setopt(easy, CURLOPT_HTTPHEADER, e->hdrs);

    // GET без тела — обычный HTTPGET; для остальных методов (и для тела)
    // честно ставим CUSTOMREQUEST, чтобы DELETE/PUT не превратились в POST.
    if ((method && strcmp(method, "GET") != 0) || body) {
        curl_easy_setopt(easy, CURLOPT_CUSTOMREQUEST, method);
    } else {
        curl_easy_setopt(easy, CURLOPT_HTTPGET, 1L);
    }
    if (body) {
        curl_easy_setopt(easy, CURLOPT_POSTFIELDS, e->req_body);
        curl_easy_setopt(easy, CURLOPT_POSTFIELDSIZE, (long)strlen(e->req_body));
    }

    if (curl_multi_add_handle(g_multi, easy) != CURLM_OK) return false;
    return true;
}

#endif // R2D_HTTP_CURL

// ===========================================================================
// Бэкенд «встроенный сокет» (только http://, без TLS)
// ===========================================================================

#ifdef R2D_HTTP_SOCKET

static bool r2d__sock_would_block(void)
{
#ifdef _WIN32
    const int err = WSAGetLastError();
    return err == WSAEWOULDBLOCK || err == WSAEINPROGRESS || err == WSAEINVAL;
#else
    return errno == EAGAIN || errno == EWOULDBLOCK || errno == EINPROGRESS;
#endif
}

static void r2d__sock_set_nonblock(r2d_socket_t fd)
{
#ifdef _WIN32
    u_long on = 1;
    ioctlsocket(fd, FIONBIO, &on);
#else
    const int flags = fcntl(fd, F_GETFL, 0);
    if (flags >= 0) fcntl(fd, F_SETFL, flags | O_NONBLOCK);
#endif
}

// Строки запроса уходят в сокет дословно. CR/LF в них позволили бы вклеить
// лишние заголовки или второй запрос (request splitting), поэтому проверяем
// всё, что подставляется в текст запроса.
static bool r2d__no_crlf(const char *s)
{
    if (!s) return true;
    for (; *s; ++s) {
        if (*s == '\r' || *s == '\n') return false;
    }
    return true;
}

// http://host[:port]/path → host/port/path. Порт по умолчанию 80.
static bool r2d__parse_http_url(const char *url, char **host_out, int *port_out, char **path_out)
{
    const char *p = url + 7;   // "http://" уже проверен вызывающим
    const char *slash = strchr(p, '/');
    const char *host_end = slash ? slash : p + strlen(p);
    const char *colon = NULL;
    for (const char *q = p; q < host_end; ++q) {
        if (*q == ':') colon = q;
    }

    size_t host_len = (size_t)((colon ? colon : host_end) - p);
    if (host_len == 0) return false;

    char *host = (char *)malloc(host_len + 1);
    if (!host) return false;
    memcpy(host, p, host_len);
    host[host_len] = '\0';

    int port = 80;
    if (colon) {
        port = atoi(colon + 1);
        if (port <= 0 || port > 65535) { free(host); return false; }
    }

    const char *path = slash ? slash : "/";
    char *path_copy = r2d__strdup(path);
    if (!path_copy) { free(host); return false; }

    *host_out = host;
    *port_out = port;
    *path_out = path_copy;
    return true;
}

static bool r2d__sock_start(R2DHttpEntry *e, const char *method, const char *url,
                            const char *body,
                            const char *const *names, const char *const *values,
                            int header_count)
{
    for (int i = 0; i < header_count; ++i) {
        if (!names[i] || !values[i]) continue;
        if (!r2d__no_crlf(names[i]) || !r2d__no_crlf(values[i])) return false;
    }
    if (!r2d__no_crlf(method)) return false;

    if (!r2d__parse_http_url(url, &e->host, &e->port, &e->path)) return false;
    if (!r2d__no_crlf(e->host) || !r2d__no_crlf(e->path)) {
        free(e->host); e->host = NULL;
        free(e->path); e->path = NULL;
        return false;
    }

    char port_text[8];
    snprintf(port_text, sizeof port_text, "%d", e->port);

    struct addrinfo hints;
    memset(&hints, 0, sizeof hints);
    hints.ai_family = AF_UNSPEC;
    hints.ai_socktype = SOCK_STREAM;
    struct addrinfo *list = NULL;
    if (getaddrinfo(e->host, port_text, &hints, &list) != 0 || !list) {
        if (list) freeaddrinfo(list);
        return false;
    }

    r2d_socket_t fd = R2D_SOCK_INVALID;
    for (struct addrinfo *ai = list; ai; ai = ai->ai_next) {
        fd = (r2d_socket_t)socket(ai->ai_family, ai->ai_socktype, ai->ai_protocol);
        if (fd == R2D_SOCK_INVALID) continue;
        r2d__sock_set_nonblock(fd);
        if (connect(fd, ai->ai_addr, (int)ai->ai_addrlen) == 0) break;
        if (r2d__sock_would_block()) break;   // соединение ещё устанавливается
        R2D_SOCK_CLOSE(fd);
        fd = R2D_SOCK_INVALID;
    }
    freeaddrinfo(list);
    if (fd == R2D_SOCK_INVALID) return false;

    e->fd = fd;
    e->state = R2D_SOCK_CONNECT;

    R2DBuf r = {0};
    r2d__buf_puts(&r, method ? method : "GET");
    r2d__buf_puts(&r, " ");
    r2d__buf_puts(&r, e->path);
    r2d__buf_puts(&r, " HTTP/1.1\r\nHost: ");
    r2d__buf_puts(&r, e->host);
    if (e->port != 80) {
        r2d__buf_puts(&r, ":");
        r2d__buf_puts(&r, port_text);
    }
    r2d__buf_puts(&r, "\r\nUser-Agent: russiano2d/" R2D_VERSION_STRING
                      "\r\nAccept: */*\r\nConnection: close\r\n");
    for (int i = 0; i < header_count; ++i) {
        if (!names[i] || !values[i]) continue;
        r2d__buf_puts(&r, names[i]);
        r2d__buf_puts(&r, ": ");
        r2d__buf_puts(&r, values[i]);
        r2d__buf_puts(&r, "\r\n");
    }
    if (body) {
        char len_text[32];
        snprintf(len_text, sizeof len_text, "%zu", strlen(body));
        r2d__buf_puts(&r, "Content-Length: ");
        r2d__buf_puts(&r, len_text);
        r2d__buf_puts(&r, "\r\n");
    }
    r2d__buf_puts(&r, "\r\n");
    if (body) r2d__buf_puts(&r, body);

    e->request = r;
    e->sent = 0;
    return true;
}

static bool r2d__wait_writable(r2d_socket_t fd, int timeout_us)
{
    fd_set wfds;
    FD_ZERO(&wfds);
    FD_SET(fd, &wfds);
    struct timeval tv;
    tv.tv_sec = 0;
    tv.tv_usec = timeout_us;
#ifdef _WIN32
    return select(0, NULL, &wfds, NULL, &tv) > 0;
#else
    return select(fd + 1, NULL, &wfds, NULL, &tv) > 0;
#endif
}

static bool r2d__wait_readable(r2d_socket_t fd, int timeout_us)
{
    fd_set rfds;
    FD_ZERO(&rfds);
    FD_SET(fd, &rfds);
    struct timeval tv;
    tv.tv_sec = 0;
    tv.tv_usec = timeout_us;
#ifdef _WIN32
    return select(0, &rfds, NULL, NULL, &tv) > 0;
#else
    return select(fd + 1, &rfds, NULL, NULL, &tv) > 0;
#endif
}

static int r2d__hex_digit(char c)
{
    if (c >= '0' && c <= '9') return c - '0';
    if (c >= 'a' && c <= 'f') return c - 'a' + 10;
    if (c >= 'A' && c <= 'F') return c - 'A' + 10;
    return -1;
}

// Раскодировать chunked-тело: без этого ответ «Connection: close» отдал бы
// игре служебные строки размеров.
static void r2d__decode_chunked(R2DBuf *out, const char *data, size_t len)
{
    size_t i = 0;
    while (i < len) {
        size_t line_end = i;
        while (line_end + 1 < len && !(data[line_end] == '\r' && data[line_end + 1] == '\n')) line_end++;
        if (line_end + 1 >= len) break;

        size_t size = 0;
        bool any = false;
        for (size_t k = i; k < line_end; ++k) {
            const char c = data[k];
            if (c == ';') break;
            if (c == ' ' || c == '\t') continue;
            const int d = r2d__hex_digit(c);
            if (d < 0) { any = false; break; }
            size = size * 16 + (size_t)d;
            any = true;
        }
        i = line_end + 2;
        if (!any || size == 0) break;
        if (size > len - i) size = len - i;
        r2d__buf_append(out, data + i, size);
        i += size;
        if (i + 1 < len && data[i] == '\r' && data[i + 1] == '\n') i += 2;
    }
}

static const char *r2d__find_header_value(const char *headers, const char *name)
{
    const size_t name_len = strlen(name);
    const char *line = headers;
    while (line && *line) {
        const char *eol = strstr(line, "\r\n");
        if (!eol) eol = line + strlen(line);
        if ((size_t)(eol - line) > name_len && r2d__starts_with_ci(line, name) &&
            line[name_len] == ':') {
            const char *v = line + name_len + 1;
            while (*v == ' ' || *v == '\t') v++;
            return v;
        }
        line = (*eol) ? eol + 2 : eol;
    }
    return NULL;
}

// Разобрать накопленный ответ и заполнить результат.
static void r2d__sock_parse(R2DHttpEntry *e)
{
    const char *raw = e->raw.data;
    const size_t len = e->raw.len;
    if (!raw || len == 0) { r2d__entry_fail(e, "сервер закрыл соединение без ответа"); return; }

    const char *sep = NULL;
    for (size_t i = 0; i + 3 < len; ++i) {
        if (raw[i] == '\r' && raw[i + 1] == '\n' && raw[i + 2] == '\r' && raw[i + 3] == '\n') {
            sep = raw + i;
            break;
        }
    }
    if (!sep) { r2d__entry_fail(e, "не удалось разобрать ответ сервера"); return; }

    const size_t head_len = (size_t)(sep - raw) + 4;
    r2d__buf_append(&e->headers, raw, head_len);

    long status = 0;
    if (r2d__starts_with_ci(raw, "HTTP/")) {
        // raw не терминирован нулём (это накопитель байтов), поэтому strchr
        // мог уйти за конец буфера. Ищем пробел в известных границах.
        const char *sp = (const char *)memchr(raw, ' ', len);
        if (sp) status = atol(sp + 1);
    }
    if (status <= 0) { r2d__entry_fail(e, "не удалось разобрать HTTP-статус"); return; }

    char head_text[4096];
    const size_t copy = head_len < sizeof head_text ? head_len : sizeof head_text - 1;
    memcpy(head_text, raw, copy);
    head_text[copy] = '\0';
    const char *te = r2d__find_header_value(head_text, "Transfer-Encoding");

    char *body = (char *)raw + head_len;
    const size_t body_len = len - head_len;
    if (te && r2d__starts_with_ci(te, "chunked")) {
        R2DBuf decoded = {0};
        r2d__decode_chunked(&decoded, body, body_len);
        // Тело может быть бинарным: strlen() обрывал бы его на первом 0x00,
        // тогда как обычный (не chunked) путь передаёт body_len. Берём длину
        // до take — take очищает буфер.
        const size_t decoded_len = decoded.len;
        char *text = r2d__buf_take(&decoded);
        r2d__buf_append(&e->body, text ? text : "", text ? decoded_len : 0);
        free(text);
    } else {
        r2d__buf_append(&e->body, body, body_len);
    }

    r2d__entry_done(e, status);
}

static void r2d__sock_update(R2DHttpEntry *e)
{
    const double elapsed = r2d__now_ms() - e->start_ms;
    if (elapsed >= e->timeout_ms) { r2d__entry_fail(e, "таймаут запроса"); return; }

    if (e->state == R2D_SOCK_CONNECT) {
        if (!r2d__wait_writable(e->fd, 0)) return;
        int err = 0;
        r2d_socklen_t err_len = (r2d_socklen_t)sizeof err;
        if (getsockopt(e->fd, SOL_SOCKET, SO_ERROR, (char *)&err, &err_len) != 0 || err != 0) {
            r2d__entry_fail(e, "не удалось подключиться к серверу");
            return;
        }
        e->state = R2D_SOCK_SEND;
    }

    if (e->state == R2D_SOCK_SEND) {
        while (e->sent < e->request.len) {
            const int n = send(e->fd, e->request.data + e->sent,
                               (int)(e->request.len - e->sent), 0);
            if (n > 0) { e->sent += (size_t)n; continue; }
            if (n < 0 && r2d__sock_would_block()) return;
            r2d__entry_fail(e, "ошибка отправки запроса");
            return;
        }
        e->state = R2D_SOCK_RECV;
    }

    if (e->state == R2D_SOCK_RECV) {
        if (!r2d__wait_readable(e->fd, 0)) return;
        char chunk[8192];
        for (;;) {
            // Предел нужен, чтобы сервер не мог залить игру бесконечным
            // потоком: раньше размер ответа ничем не ограничивался.
            if (e->raw.len > R2D_HTTP_MAX_RESPONSE) {
                r2d__entry_fail(e, "ответ сервера слишком большой");
                return;
            }
            if (r2d__now_ms() - e->start_ms >= e->timeout_ms) {
                r2d__entry_fail(e, "таймаут запроса");
                return;
            }
            const int n = recv(e->fd, chunk, (int)sizeof chunk, 0);
            if (n > 0) {
                if (!r2d__buf_append(&e->raw, chunk, (size_t)n)) {
                    r2d__entry_fail(e, "не хватило памяти на ответ");
                    return;
                }
                continue;
            }
            if (n == 0) { r2d__sock_parse(e); return; }   // сервер закрыл соединение
            if (r2d__sock_would_block()) return;
            r2d__entry_fail(e, "ошибка чтения ответа");
            return;
        }
    }
}

#endif // R2D_HTTP_SOCKET

// ===========================================================================
// Публичный C-контракт
// ===========================================================================

bool r2d_http_init(void)
{
    if (g_ready) return true;
#ifdef R2D_HTTP_CURL
    if (!g_curl_inited) {
        if (curl_global_init(CURL_GLOBAL_DEFAULT) != CURLE_OK) return false;
        g_curl_inited = true;
    }
    if (!g_multi) {
        g_multi = curl_multi_init();
        if (!g_multi) return false;
    }
    g_ready = true;
    return true;
#elif defined(R2D_HTTP_SOCKET)
#ifdef _WIN32
    if (!g_wsa_started) {
        WSADATA wsa;
        if (WSAStartup(MAKEWORD(2, 2), &wsa) != 0) return false;
        g_wsa_started = true;
    }
#endif
    g_ready = true;
    return true;
#else
    return false;   // сборка без R2D_ENABLE_HTTP: игра получит честное «нет»
#endif
}

void r2d_http_shutdown(void)
{
    for (int i = 0; i < R2D_HTTP_MAX; ++i) {
        if (g_entries[i].used) r2d__entry_clear(&g_entries[i]);
    }
#ifdef R2D_HTTP_CURL
    if (g_multi) {
        curl_multi_cleanup(g_multi);
        g_multi = NULL;
    }
    if (g_curl_inited) {
        curl_global_cleanup();
        g_curl_inited = false;
    }
#endif
#if defined(R2D_HTTP_SOCKET) && defined(_WIN32)
    if (g_wsa_started) {
        WSACleanup();
        g_wsa_started = false;
    }
#endif
    g_ready = false;
}

int r2d_http_request(const char *method, const char *url, const char *body,
                     const char *const *header_names,
                     const char *const *header_values, int header_count,
                     double timeout_ms)
{
    R2DHttpEntry *e = r2d__entry_new();
    if (!e) return -1;
    e->timeout_ms = timeout_ms > 0 ? timeout_ms : R2D_HTTP_DEFAULT_TIMEOUT_MS;

    if (!r2d_http_init()) {
        r2d__entry_fail(e, "HTTP выключен при сборке движка");
        return e->id;
    }
    if (!url || !*url) {
        r2d__entry_fail(e, "невалидный URL: пустая строка");
        return e->id;
    }

    const bool is_http = r2d__starts_with_ci(url, "http://");
    const bool is_https = r2d__starts_with_ci(url, "https://");
    if (!is_http && !is_https) {
        r2d__entry_fail(e, "невалидный URL: нужен http:// или https://");
        return e->id;
    }

#ifndef R2D_HTTP_CURL
    if (is_https) {
        r2d__entry_fail(e, "https недоступен: движок собран без libcurl, "
                           "используйте http:// или пересоберите с libcurl");
        return e->id;
    }
#endif

    const char *use_method = (method && *method) ? method : "GET";

#ifdef R2D_HTTP_CURL
    if (!r2d__curl_start(e, use_method, url, body, header_names, header_values,
                         header_count, e->timeout_ms)) {
        r2d__entry_fail(e, "не удалось подготовить запрос (libcurl)");
    }
    return e->id;
#elif defined(R2D_HTTP_SOCKET)
    if (!r2d__sock_start(e, use_method, url, body, header_names, header_values, header_count)) {
        r2d__entry_fail(e, "не удалось подключиться к серверу");
    }
    return e->id;
#else
    R2D_UNUSED(body);
    R2D_UNUSED(header_names);
    R2D_UNUSED(header_values);
    R2D_UNUSED(header_count);
    r2d__entry_fail(e, "HTTP выключен при сборке движка");
    return e->id;
#endif
}

void r2d_http_update(void)
{
    if (!g_ready) return;

#ifdef R2D_HTTP_CURL
    int running = 0;
    curl_multi_perform(g_multi, &running);

    int pending = 0;
    CURLMsg *msg = NULL;
    while ((msg = curl_multi_info_read(g_multi, &pending)) != NULL) {
        if (msg->msg != CURLMSG_DONE) continue;
        R2DHttpEntry *e = NULL;
        CURL *easy = msg->easy_handle;
        for (int i = 0; i < R2D_HTTP_MAX; ++i) {
            if (g_entries[i].used && g_entries[i].easy == easy) { e = &g_entries[i]; break; }
        }
        if (e) {
            r2d__curl_finish(e, msg->data.result);
        } else {
            // Запись уже отменена: подчищаем осиротевший handle.
            curl_multi_remove_handle(g_multi, easy);
            curl_easy_cleanup(easy);
        }
    }
#elif defined(R2D_HTTP_SOCKET)
    for (int i = 0; i < R2D_HTTP_MAX; ++i) {
        R2DHttpEntry *e = &g_entries[i];
        if (e->used && !e->done) r2d__sock_update(e);
    }
#endif
}

bool r2d_http_poll(int id, R2DHttpResult *out)
{
    if (!out) return false;
    R2DHttpEntry *e = r2d__entry_find(id);
    if (!e || !e->done) return false;

    *out = e->res;
    memset(&e->res, 0, sizeof(e->res));
    e->used = false;
    e->done = false;
    r2d__entry_release_backend(e);
    r2d__buf_free(&e->body);
    r2d__buf_free(&e->headers);
    return true;
}

void r2d_http_cancel(int id)
{
    R2DHttpEntry *e = r2d__entry_find(id);
    if (e) r2d__entry_clear(e);
}

int r2d_http_active(void)
{
    int count = 0;
    for (int i = 0; i < R2D_HTTP_MAX; ++i) {
        if (g_entries[i].used) count++;
    }
    return count;
}

bool r2d_http_available(void)
{
#if defined(R2D_HTTP_CURL) || defined(R2D_HTTP_SOCKET)
    return g_ready || r2d_http_init();
#else
    return false;
#endif
}

const char *r2d_http_backend(void)
{
#if defined(R2D_HTTP_CURL)
    return "curl";
#elif defined(R2D_HTTP_SOCKET)
    return "socket";
#else
    return "none";
#endif
}

void r2d_http_free(R2DHttpResult *r)
{
    if (!r) return;
    free(r->body);
    free(r->headers);
    free(r->error);
    memset(r, 0, sizeof(*r));
}

// ===========================================================================
// Биндинги engine.http.* для $.http
// ===========================================================================

// Прочитать необязательную строку из поля объекта.
static char *r2d__js_opt_string(JSContext *ctx, JSValueConst obj, const char *key)
{
    JSValue v = JS_GetPropertyStr(ctx, obj, key);
    char *out = NULL;
    if (JS_IsString(v)) out = (char *)JS_ToCString(ctx, v);
    JS_FreeValue(ctx, v);
    return out;
}

// Заголовки приходят плоским массивом [имя, значение, имя, значение, ...]:
// так их дешевле разбирать и на стороне JS, и здесь.
static char **r2d__js_read_flat_strings(JSContext *ctx, JSValueConst value, int *count_out)
{
    *count_out = 0;
    if (!JS_IsArray(value)) return NULL;

    JSValue len_val = JS_GetPropertyStr(ctx, value, "length");
    int32_t len = 0;
    if (JS_ToInt32(ctx, &len, len_val) < 0 || len <= 0) {
        JS_FreeValue(ctx, len_val);
        return NULL;
    }
    JS_FreeValue(ctx, len_val);

    char **out = (char **)calloc((size_t)len, sizeof(char *));
    if (!out) return NULL;

    int n = 0;
    for (int32_t i = 0; i < len; ++i) {
        JSValue item = JS_GetPropertyUint32(ctx, value, (uint32_t)i);
        if (JS_IsString(item)) {
            char *text = (char *)JS_ToCString(ctx, item);
            if (text) out[n++] = text;
        }
        JS_FreeValue(ctx, item);
    }
    *count_out = n;
    return out;
}

static void r2d__js_free_flat_strings(JSContext *ctx, char **list, int count)
{
    if (!list) return;
    for (int i = 0; i < count; ++i) JS_FreeCString(ctx, list[i]);
    free(list);
}

static JSValue r2d__js_http_request(JSContext *ctx, JSValueConst this_val,
                                    int argc, JSValueConst *argv)
{
    R2D_UNUSED(this_val);
    if (argc < 1 || !JS_IsObject(argv[0])) {
        JS_ThrowTypeError(ctx, "engine.http.request(opts) — нужен объект с полем url");
        return JS_EXCEPTION;
    }
    JSValueConst opts = argv[0];

    char *url = r2d__js_opt_string(ctx, opts, "url");
    if (!url) {
        JS_ThrowTypeError(ctx, "engine.http.request: нет строки url");
        return JS_EXCEPTION;
    }
    char *method = r2d__js_opt_string(ctx, opts, "method");
    char *body = r2d__js_opt_string(ctx, opts, "body");

    JSValue timeout_val = JS_GetPropertyStr(ctx, opts, "timeout");
    double timeout = 0;
    if (!JS_IsUndefined(timeout_val) && !JS_IsNull(timeout_val)) JS_ToFloat64(ctx, &timeout, timeout_val);
    JS_FreeValue(ctx, timeout_val);

    JSValue headers_val = JS_GetPropertyStr(ctx, opts, "headers");
    int flat_count = 0;
    char **flat = r2d__js_read_flat_strings(ctx, headers_val, &flat_count);
    JS_FreeValue(ctx, headers_val);

    // r2d_http_request ждёт два независимых массива, а из JS приходит плоский
    // [имя, значение, ...] — раскладываем по чётным и нечётным индексам.
    const int header_count = flat_count / 2;
    const char **names = NULL;
    const char **values = NULL;
    if (header_count > 0) {
        names = (const char **)calloc((size_t)header_count, sizeof(char *));
        values = (const char **)calloc((size_t)header_count, sizeof(char *));
        if (names && values) {
            for (int i = 0; i < header_count; ++i) {
                names[i] = flat[i * 2];
                values[i] = flat[i * 2 + 1];
            }
        }
    }

    const int id = r2d_http_request(method, url, body, names, values,
                                    (names && values) ? header_count : 0, timeout);

    free(names);
    free(values);
    JS_FreeCString(ctx, url);
    if (method) JS_FreeCString(ctx, method);
    if (body) JS_FreeCString(ctx, body);
    r2d__js_free_flat_strings(ctx, flat, flat_count);
    return JS_NewInt32(ctx, id);
}

static JSValue r2d__js_http_poll(JSContext *ctx, JSValueConst this_val,
                                 int argc, JSValueConst *argv)
{
    R2D_UNUSED(this_val);
    if (argc < 1) return JS_NULL;
    int32_t id = -1;
    JS_ToInt32(ctx, &id, argv[0]);

    R2DHttpResult r;
    memset(&r, 0, sizeof r);
    if (!r2d_http_poll(id, &r)) return JS_NULL;

    JSValue obj = JS_NewObject(ctx);
    JS_SetPropertyStr(ctx, obj, "done", JS_TRUE);
    JS_SetPropertyStr(ctx, obj, "status", JS_NewInt32(ctx, (int32_t)r.status));
    JS_SetPropertyStr(ctx, obj, "body",
                      r.body ? JS_NewStringLen(ctx, r.body, r.body_len) : JS_NewString(ctx, ""));
    JS_SetPropertyStr(ctx, obj, "headers",
                      r.headers ? JS_NewString(ctx, r.headers) : JS_NewString(ctx, ""));
    JS_SetPropertyStr(ctx, obj, "error",
                      r.error ? JS_NewString(ctx, r.error) : JS_NULL);
    JS_SetPropertyStr(ctx, obj, "timeMs", JS_NewFloat64(ctx, r.time_ms));
    r2d_http_free(&r);
    return obj;
}

static JSValue r2d__js_http_cancel(JSContext *ctx, JSValueConst this_val,
                                   int argc, JSValueConst *argv)
{
    R2D_UNUSED(this_val);
    if (argc >= 1) {
        int32_t id = -1;
        JS_ToInt32(ctx, &id, argv[0]);
        r2d_http_cancel(id);
    }
    return JS_UNDEFINED;
}

static JSValue r2d__js_http_active(JSContext *ctx, JSValueConst this_val,
                                   int argc, JSValueConst *argv)
{
    R2D_UNUSED(this_val); R2D_UNUSED(argc); R2D_UNUSED(argv);
    return JS_NewInt32(ctx, r2d_http_active());
}

static JSValue r2d__js_http_backend(JSContext *ctx, JSValueConst this_val,
                                    int argc, JSValueConst *argv)
{
    R2D_UNUSED(this_val); R2D_UNUSED(argc); R2D_UNUSED(argv);
    return JS_NewString(ctx, r2d_http_backend());
}

static JSValue r2d__js_http_available(JSContext *ctx, JSValueConst this_val,
                                      int argc, JSValueConst *argv)
{
    R2D_UNUSED(this_val); R2D_UNUSED(argc); R2D_UNUSED(argv);
    return JS_NewBool(ctx, r2d_http_available());
}

static void r2d__http_set_fn(JSContext *ctx, JSValue obj, const char *name,
                             JSCFunction *fn, int len)
{
    JS_SetPropertyStr(ctx, obj, name, JS_NewCFunction(ctx, fn, name, len));
}

void r2d_http_register_js(JSContext *ctx, JSValue engine)
{
    JSValue http = JS_NewObject(ctx);
    r2d__http_set_fn(ctx, http, "request", r2d__js_http_request, 1);
    r2d__http_set_fn(ctx, http, "poll", r2d__js_http_poll, 1);
    r2d__http_set_fn(ctx, http, "cancel", r2d__js_http_cancel, 1);
    r2d__http_set_fn(ctx, http, "active", r2d__js_http_active, 0);
    r2d__http_set_fn(ctx, http, "backend", r2d__js_http_backend, 0);
    r2d__http_set_fn(ctx, http, "available", r2d__js_http_available, 0);

    // Движок без инициализации отвечает «нет бэкенда» — игра деградирует мягко.
    r2d_http_init();
    JS_SetPropertyStr(ctx, engine, "http", http);
}
