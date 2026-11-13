import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { initOkiI18n } from '@oki/i18n';
import { App } from './App';
import { AuthProvider } from './state/auth';
import { FamilyProvider } from './state/family';
import { LocaleProvider } from './state/locale';
import './styles.css';

async function bootstrap() {
  try {
    await initOkiI18n();
  } catch (err) {
    console.error('[Oki] i18n init failed', err);
  }
  const root = document.getElementById('root');
  if (!root) throw new Error('root missing');
  createRoot(root).render(
    <StrictMode>
      <LocaleProvider>
        <AuthProvider>
          <FamilyProvider>
            <App />
          </FamilyProvider>
        </AuthProvider>
      </LocaleProvider>
    </StrictMode>,
  );
}

void bootstrap().catch((err) => {
  console.error('[Oki] bootstrap failed', err);
  const root = document.getElementById('root');
  if (root) {
    // Build with DOM APIs — the error text must never be parsed as HTML.
    const box = document.createElement('div');
    box.dir = 'rtl';
    box.setAttribute('role', 'alert');
    box.style.cssText = 'padding:1.25rem;font-family:Heebo,system-ui';
    const h = document.createElement('h2');
    h.textContent = 'לא ניתן לטעון את אוקי משפחה';
    const pre = document.createElement('pre');
    pre.style.whiteSpace = 'pre-wrap';
    pre.textContent = String(err);
    box.append(h, pre);
    root.replaceChildren(box);
  }
});
