/* Russiano2D — лендинг: меню, табы, подсветка кода, лайтбокс. Без зависимостей. */
(function () {
  'use strict';

  /* ── мобильное меню ─────────────────────────────────────────────── */
  var burger = document.getElementById('burger');
  var menu = document.getElementById('menu');
  if (burger && menu) {
    var setOpen = function (open) {
      menu.classList.toggle('is-open', open);
      burger.setAttribute('aria-expanded', open ? 'true' : 'false');
    };
    burger.addEventListener('click', function () { setOpen(!menu.classList.contains('is-open')); });
    menu.addEventListener('click', function (e) {
      if (e.target.tagName === 'A') setOpen(false);
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && menu.classList.contains('is-open')) { setOpen(false); burger.focus(); }
    });
  }

  /* ── табы с кодом ───────────────────────────────────────────────── */
  var tabs = document.querySelectorAll('.tab');
  Array.prototype.forEach.call(tabs, function (tab, idx) {
    tab.addEventListener('keydown', function (e) {
      var d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
      if (!d) return;
      var next = tabs[(idx + d + tabs.length) % tabs.length];
      next.focus(); next.click(); e.preventDefault();
    });
    tab.addEventListener('click', function () {
      var name = tab.getAttribute('data-tab');
      Array.prototype.forEach.call(tabs, function (t) {
        t.classList.toggle('is-active', t === tab);
        t.setAttribute('aria-selected', t === tab ? 'true' : 'false');
        t.tabIndex = t === tab ? 0 : -1;
      });
      Array.prototype.forEach.call(document.querySelectorAll('.pane[data-pane]'), function (p) {
        p.classList.toggle('is-active', p.getAttribute('data-pane') === name);
      });
    });
  });

  /* ── подсветка кода ─────────────────────────────────────────────── */
  function esc(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  var JS_RE = new RegExp([
    '(\\/\\/[^\\n]*)',                                              // 1 комментарий
    '(|\\/\\*[\\s\\S]*?\\*\\/)',                                    // 2 блочный
    "('(?:[^'\\\\\\n]|\\\\.)*'|\"(?:[^\"\\\\\\n]|\\\\.)*\"|`(?:[^`\\\\]|\\\\.)*`)", // 3 строка
    '\\b(const|let|var|function|return|if|else|for|while|new|class|extends|this|true|false|null|undefined|of|in|typeof)\\b', // 4
    '\\b(\\d+(?:\\.\\d+)?)\\b',                                     // 5 число
    '([A-Za-z_$][\\w$]*)(?=\\()'                                    // 6 вызов
  ].join('|'), 'g');

  var BASH_RE = new RegExp([
    '(#[^\\n]*)',
    "('(?:[^'\\\\\\n]|\\\\.)*'|\"(?:[^\"\\\\\\n]|\\\\.)*\")",
    '(\\s--?[\\w-]+)'
  ].join('|'), 'g');

  function highlight(code, lang) {
    var text = esc(code.textContent);
    if (lang === 'js') {
      return text.replace(JS_RE, function (m, line, block, str, kw, num, fn) {
        if (line || block) return '<span class="tok-com">' + m + '</span>';
        if (str) return '<span class="tok-str">' + m + '</span>';
        if (kw) return '<span class="tok-kw">' + m + '</span>';
        if (num) return '<span class="tok-num">' + m + '</span>';
        if (fn) return '<span class="tok-fn">' + m + '</span>';
        return m;
      });
    }
    return text.replace(BASH_RE, function (m, com, str, flag) {
      if (com) return '<span class="tok-com">' + m + '</span>';
      if (str) return '<span class="tok-str">' + m + '</span>';
      if (flag) return '<span class="tok-prop">' + m + '</span>';
      return m;
    });
  }

  Array.prototype.forEach.call(document.querySelectorAll('code.lang-js, code.lang-bash'), function (code) {
    code.innerHTML = highlight(code, code.classList.contains('lang-js') ? 'js' : 'bash');
  });

  /* ── кнопка «копировать» у каждого блока кода ───────────────────── */
  Array.prototype.forEach.call(document.querySelectorAll('.pane'), function (pane) {
    var btn = document.createElement('button');
    btn.className = 'copy-btn';
    btn.type = 'button';
    btn.textContent = 'Копировать';
    btn.addEventListener('click', function () {
      var code = pane.querySelector('code');
      var text = code ? code.textContent : pane.textContent;
      var done = function () {
        btn.textContent = 'Скопировано';
        setTimeout(function () { btn.textContent = 'Копировать'; }, 1600);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done, done);
      } else {
        var ta = document.createElement('textarea');
        ta.value = text; document.body.appendChild(ta); ta.select();
        try { document.execCommand('copy'); } catch (e) {}
        document.body.removeChild(ta); done();
      }
    });
    pane.appendChild(btn);
  });

  /* ── лайтбокс для скриншотов ────────────────────────────────────── */
  var lb = document.getElementById('lightbox');
  if (lb) {
    var lbImg = lb.querySelector('img');
    var opener = null;
    var close = function () { lb.hidden = true; lbImg.src = ''; if (opener) opener.focus(); };
    Array.prototype.forEach.call(document.querySelectorAll('[data-lightbox]'), function (a) {
      a.addEventListener('click', function (e) {
        e.preventDefault();
        lbImg.src = a.getAttribute('href');
        lbImg.alt = (a.querySelector('img') || {}).alt || '';
        lb.hidden = false;
        opener = a;
        lb.querySelector('.lb-close').focus();
      });
    });
    lb.addEventListener('click', function (e) { if (e.target !== lbImg) close(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !lb.hidden) close(); });
  }

  /* ── появление блоков при скролле ───────────────────────────────── */
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!reduce && 'IntersectionObserver' in window) {
    var targets = document.querySelectorAll('.card, .demo, .dl-card, .doc-link, .gallery, .arch-node');
    Array.prototype.forEach.call(targets, function (el) { el.classList.add('reveal'); });
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) { en.target.classList.add('is-in'); io.unobserve(en.target); }
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.05 });
    Array.prototype.forEach.call(targets, function (el) { io.observe(el); });
  }
})();
