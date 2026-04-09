import Link from "next/link";

type Props = { variant?: "light" | "dark" };

export function LandingFooter({ variant = "light" }: Props) {
  const isDark = variant === "dark";
  return (
    <footer
      className={[
        "border-t",
        isDark
          ? "bg-black border-white/10 text-slate-400"
          : "bg-white border-slate-200 text-slate-500",
      ].join(" ")}
    >
      <div className="mx-auto max-w-6xl px-6 py-12 flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
        <div className="flex items-center gap-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/icon.png" alt="" className="h-6 w-6" />
          <span className={isDark ? "text-white font-semibold" : "text-slate-900 font-semibold"}>
            Open Regime
          </span>
        </div>
        <nav className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
          <Link href="/terms" className="hover:underline">利用規約</Link>
          <Link href="/privacy" className="hover:underline">プライバシーポリシー</Link>
          <Link href="/about" className="hover:underline">About</Link>
          <Link href="/contact" className="hover:underline">お問い合わせ</Link>
          <a href="https://twitter.com" target="_blank" rel="noreferrer" className="hover:underline">Twitter</a>
        </nav>
        <div className="text-xs">© {new Date().getFullYear()} Open Regime</div>
      </div>
    </footer>
  );
}
