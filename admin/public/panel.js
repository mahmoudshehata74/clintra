document.addEventListener('click', (event) => {
  const open = event.target.closest('[data-open-step-up]');
  if (open) {
    const form = open.closest('form');
    const fields = [...form.querySelectorAll('input:not([name="otp"])')];
    if (fields.every((field) => field.reportValidity())) {
      form.querySelector('dialog').showModal();
      form.querySelector('[name="otp"]').focus();
    }
  }
  const close = event.target.closest('[data-close-step-up]');
  if (close) close.closest('dialog').close();
});
document.addEventListener('input', (event) => {
  if (event.target.name === 'otp') event.target.value = event.target.value.replace(/[٠-٩]/g, (n) => String(n.charCodeAt(0) - 1632)).replace(/[۰-۹]/g, (n) => String(n.charCodeAt(0) - 1776));
});
