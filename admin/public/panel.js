document.addEventListener('click', (event) => {
  const open = event.target.closest('[data-open-step-up]');
  if (open) {
    const form = open.closest('form');
    const fields = [...form.querySelectorAll('input:not([name="otp"]), textarea, select')];
    if (fields.every((field) => field.reportValidity())) {
      form.querySelector('dialog').showModal();
      form.querySelector('[name="otp"]').focus();
    }
  }
  const close = event.target.closest('[data-close-step-up]');
  if (close) close.closest('dialog').close();
  const copy = event.target.closest('[data-copy-code]');
  if (copy) {
    const value = document.querySelector('[data-minted-code]')?.textContent?.trim();
    if (value) navigator.clipboard.writeText(value).then(() => { copy.textContent = 'اتنسخ الكود'; });
  }
});
document.addEventListener('input', (event) => {
  if (event.target.matches('[data-disable-reason]')) {
    document.getElementById('disable-reason-count').textContent = `${Array.from(event.target.value).length}/200`;
  }
  if (event.target.name === 'otp') event.target.value = event.target.value.replace(/[٠-٩]/g, (n) => String(n.charCodeAt(0) - 1632)).replace(/[۰-۹]/g, (n) => String(n.charCodeAt(0) - 1776));
});
