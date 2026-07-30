import { useState } from 'react';
import { Button } from '../ui/Button';
import { Field, TextInput } from '../ui/Field';
import { describeError, supabase } from '../lib/supabase';

/**
 * Giris ekrani.
 *
 * Tek kullanicili sistem: kayit ekrani YOK, hesap kurulum sirasinda
 * olusturulur. Oturum safeStorage'da sifreli saklanir, dolayisiyla program
 * her acilista sifre sormaz - kasada pratik olan bu.
 */
export function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);

    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });

    if (signInError) {
      setError(describeError(signInError));
      setBusy(false);
    }
    // Basarili giriste onAuthStateChange devreyi alir; busy'i birakmiyoruz ki
    // ekran gecisi sirasinda buton tekrar tiklanabilir hale gelmesin
  }

  return (
    <div className="flex h-full items-center justify-center bg-(--color-surface-sunken) p-6">
      <form
        onSubmit={submit}
        className="w-full max-w-sm rounded-(--radius-card) border border-(--color-border) bg-(--color-surface-raised) p-7"
      >
        <h1 className="text-xl font-bold">Adisyon</h1>
        <p className="mt-1 mb-6 text-sm text-(--color-text-muted)">Devam etmek için giriş yapın.</p>

        <div className="space-y-4">
          <Field label="E-posta">
            <TextInput
              type="email"
              autoComplete="username"
              autoFocus
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </Field>

          <Field label="Şifre">
            <TextInput
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </Field>
        </div>

        {error && (
          <p
            role="alert"
            className="mt-4 rounded-(--radius-control) bg-(--color-status-alert-soft) px-3 py-2 text-sm text-(--color-status-alert)"
          >
            {error}
          </p>
        )}

        <Button type="submit" size="lg" className="mt-6 w-full" disabled={busy}>
          {busy ? 'Giriş yapılıyor…' : 'Giriş yap'}
        </Button>
      </form>
    </div>
  );
}
