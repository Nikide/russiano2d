#include "fs_util.h"

#include <errno.h>
#include <stdio.h>
#include <string.h>

#ifdef _WIN32
#include <windows.h>
#include <io.h>
#include <process.h>
#else
#include <unistd.h>
#endif

static void set_error(char *error, size_t size, const char *what, const char *path, int err)
{
    if (!error || size == 0) return;
    const char *reason = err > 0 ? strerror(err) : "причина не сообщена системой";
#ifdef _WIN32
    if (err == 0) {
        DWORD code = GetLastError();
        if (code) {
            static char win[256];
            FormatMessageA(FORMAT_MESSAGE_FROM_SYSTEM | FORMAT_MESSAGE_IGNORE_INSERTS,
                           NULL, code, 0, win, (DWORD)sizeof win, NULL);
            reason = win;
        }
    }
#endif
    snprintf(error, size, "%s \"%s\": %s (errno %d)", what, path, reason, err);
}

static unsigned r2d_fs_counter;

static void temp_path_for(const char *path, char *out, size_t size)
{
#ifdef _WIN32
    const long pid = (long)_getpid();
#else
    const long pid = (long)getpid();
#endif
    snprintf(out, size, "%s.tmp.%ld.%u", path, pid, ++r2d_fs_counter);
}

bool r2d_fs_rename_replace(const char *from, const char *to, char *error, size_t error_size)
{
    if (!from || !*from || !to || !*to) {
        set_error(error, error_size, "переименовать", (from && *from) ? from : to, EINVAL);
        return false;
    }
#ifdef _WIN32
    if (MoveFileExA(from, to, MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH)) return true;
    set_error(error, error_size, "переименовать", from, 0);
    return false;
#else
    if (rename(from, to) == 0) return true;
    set_error(error, error_size, "переименовать", from, errno);
    return false;
#endif
}

bool r2d_fs_write_atomic(const char *path, const void *data, size_t len,
                         char *error, size_t error_size)
{
    if (!path || !*path) {
        set_error(error, error_size, "атомарно записать", "", EINVAL);
        return false;
    }
    char tmp[4096];
    temp_path_for(path, tmp, sizeof tmp);

    FILE *file = fopen(tmp, "wb");
    if (!file) {
        set_error(error, error_size, "создать временный файл", tmp, errno);
        return false;
    }
    bool ok = true;
    if (len > 0 && data) {
        const size_t written = fwrite(data, 1, len, file);
        if (written != len) {
            set_error(error, error_size, "записать временный файл", tmp, errno);
            ok = false;
        }
    }
    if (ok && fflush(file) != 0) {
        set_error(error, error_size, "сбросить временный файл", tmp, errno);
        ok = false;
    }
#ifdef _WIN32
    if (ok && _commit(_fileno(file)) != 0) {
        set_error(error, error_size, "fsync временного файла", tmp, errno);
        ok = false;
    }
#else
    if (ok && fsync(fileno(file)) != 0) {
        set_error(error, error_size, "fsync временного файла", tmp, errno);
        ok = false;
    }
#endif
    if (fclose(file) != 0 && ok) {
        set_error(error, error_size, "закрыть временный файл", tmp, errno);
        ok = false;
    }

    if (!ok) {
        remove(tmp);
        return false;
    }
    if (!r2d_fs_rename_replace(tmp, path, error, error_size)) {
        remove(tmp);
        return false;
    }
    return true;
}
