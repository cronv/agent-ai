/**
 * Стили виджета одной строкой — они кладутся в <style> внутри Shadow DOM,
 * отдельного CSS-файла рядом с widget.js не появляется.
 */
export const styles = `
:host, * { box-sizing: border-box; }

.launcher {
  position: fixed;
  right: 20px;
  bottom: 20px;
  z-index: 2147483000;
  display: inline-flex;
  align-items: center;
  gap: 10px;
  padding: 14px 20px;
  border: 0;
  border-radius: 999px;
  background: var(--accent, #2F6BFF);
  color: #fff;
  font: 500 15px/1.2 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  cursor: pointer;
  box-shadow: 0 8px 28px rgba(16, 24, 40, .22);
  transition: transform .15s ease, box-shadow .15s ease;
}
.launcher:hover { transform: translateY(-1px); box-shadow: 0 12px 32px rgba(16, 24, 40, .28); }
.launcher:active { transform: translateY(0); }

.note {
  position: fixed;
  right: 20px;
  bottom: 78px;
  z-index: 2147483000;
  max-width: 280px;
  padding: 14px 16px;
  border-radius: 14px;
  background: #fff;
  color: #16181d;
  font: 400 14px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  box-shadow: 0 10px 30px rgba(16, 24, 40, .16);
}

@media (max-width: 480px) {
  .launcher { right: 12px; bottom: 12px; }
  .note { right: 12px; left: 12px; bottom: 70px; max-width: none; }
}
`
