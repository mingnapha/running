export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="auth-page">
      <div className="auth-card stack">{children}</div>
    </main>
  );
}
