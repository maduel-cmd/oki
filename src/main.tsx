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
    root.innerHTML =
      '<div style="padding:1.25rem;font-family:Heebo,system-ui" dir="rtl" role="alert">' +
      '<h2>לא ניתן לטעון את אוקי משפחה</h2>' +
      '<pre style="white-space:pre-wrap">' +
      String(err) +
      '</pre></div>';
  }
});
