(function (global) {
  'use strict';

  function ensureTotpModal() {
    var modal = document.getElementById('totpModal');
    if (modal) return modal;
    modal = document.createElement('div');
    modal.id = 'totpModal';
    modal.className = 'totp-modal';
    modal.innerHTML =
      '<div class="totp-modal-content">' +
      '<form id="totpForm" autocomplete="off">' +
      '<h3>Код из приложения</h3>' +
      '<p id="totpMsg" class="totp-msg">Введите 6-значный код из приложения-аутентификатора</p>' +
      '<input id="totpInput" type="text" inputmode="numeric" maxlength="12" autocomplete="one-time-code" placeholder="123456" />' +
      '<div class="totp-btns">' +
      '<button type="button" id="totpCancel" class="totp-cancel">Отмена</button>' +
      '<button type="submit" id="totpSubmit" class="totp-ok">OK</button>' +
      '</div></form></div>';
    document.body.appendChild(modal);
    if (!document.getElementById('totpModalStyles')) {
      var st = document.createElement('style');
      st.id = 'totpModalStyles';
      st.textContent =
        '.totp-modal{display:none;position:fixed;inset:0;background:rgba(15,23,42,.55);z-index:10001;align-items:center;justify-content:center;padding:16px}' +
        '.totp-modal.open{display:flex}' +
        '.totp-modal-content{background:#fff;border-radius:16px;padding:24px;width:min(380px,92vw);box-shadow:0 24px 64px rgba(0,0,0,.25);text-align:center}' +
        '.totp-modal-content h3{margin:0 0 8px;font-size:18px;color:#0f172a}' +
        '.totp-msg{color:#64748b;font-size:13px;line-height:1.45;margin:0 0 14px}' +
        '.totp-modal-content input{width:100%;box-sizing:border-box;padding:14px;font-size:24px;letter-spacing:8px;text-align:center;border:2px solid #93c5fd;border-radius:12px;outline:none}' +
        '.totp-modal-content input:focus{border-color:#2563eb;box-shadow:0 0 0 3px rgba(37,99,235,.15)}' +
        '.totp-btns{display:flex;gap:10px;margin-top:16px}' +
        '.totp-btns button{flex:1;padding:12px;border-radius:10px;font-size:14px;font-weight:700;cursor:pointer}' +
        '.totp-cancel{border:1px solid #cbd5e1;background:#fff;color:#64748b}' +
        '.totp-ok{border:none;background:#2563eb;color:#fff}';
      document.head.appendChild(st);
    }
    return modal;
  }

  function promptDashboardTotp(message) {
    return new Promise(function (resolve, reject) {
      var modal = ensureTotpModal();
      var form = modal.querySelector('#totpForm');
      var inp = modal.querySelector('#totpInput');
      var msgEl = modal.querySelector('#totpMsg');
      msgEl.textContent = message || 'Введите 6-значный код из приложения-аутентификатора';
      inp.value = '';
      modal.classList.add('open');
      setTimeout(function () {
        inp.focus();
      }, 50);
      function cleanup() {
        modal.classList.remove('open');
        form.onsubmit = null;
      }
      function submit() {
        var code = inp.value.replace(/\D/g, '').slice(0, 6);
        if (code.length !== 6) {
          inp.focus();
          return;
        }
        cleanup();
        resolve(code);
      }
      form.onsubmit = function (e) {
        e.preventDefault();
        submit();
      };
      modal.querySelector('#totpCancel').onclick = function () {
        cleanup();
        reject(new Error('TOTP cancelled'));
      };
    });
  }

  global.promptDashboardTotp = promptDashboardTotp;
})(typeof window !== 'undefined' ? window : global);
