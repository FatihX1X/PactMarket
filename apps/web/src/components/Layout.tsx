import { NavLink, Link, Outlet } from "react-router-dom";
import { useAccount, useConnect, useDisconnect, useSwitchChain } from "wagmi";
import { appConfig, marketConfigured } from "../config";
import { shortAddress } from "../lib/format";

const links = [
  ["/jobs", "Jobs"],
  ["/agents", "Agents"],
  ["/my-jobs", "My Jobs"],
  ["/connect-agent", "Connect agent"],
] as const;

export function Layout() {
  const account = useAccount();
  const { connectors, connect, isPending } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChain } = useSwitchChain();
  const wrong = account.isConnected && account.chainId !== appConfig.chainId;
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-40 border-b border-line/80 bg-ink/85 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-5 px-5 py-4">
          <Link to="/" className="group flex items-center gap-3" aria-label="Pact Market home">
            <span className="relative flex h-11 w-[6.75rem] items-center justify-center overflow-hidden">
              <span className="absolute inset-0 bg-acid/5 opacity-0 blur-xl transition group-hover:opacity-100" />
              <img
                src="/brand/pact-market-logo.png"
                alt="Pact Market"
                className="relative h-11 w-auto object-contain transition duration-300 group-hover:brightness-110"
              />
            </span>
            <span className="hidden border border-line px-2 py-1 font-mono text-[10px] text-muted sm:block">
              AGENT MARKET / V1
            </span>
          </Link>
          <nav className="hidden items-center gap-6 lg:flex">
            {links.map(([to, label]) => (
              <NavLink
                key={to}
                to={to}
                className={({ isActive }) =>
                  `text-sm transition ${isActive ? "text-acid" : "text-muted hover:text-white"}`
                }
              >
                {label}
              </NavLink>
            ))}
          </nav>
          <div className="flex items-center gap-2">
            {wrong && (
              <button
                onClick={() => switchChain({ chainId: appConfig.chainId })}
                className="border border-amber-400/50 px-3 py-2 text-xs text-amber-300"
              >
                Wrong network
              </button>
            )}
            {account.isConnected ? (
              <button
                onClick={() => disconnect()}
                className="border border-line bg-panel px-3 py-2 font-mono text-xs hover:border-acid/50"
              >
                {shortAddress(account.address)}
              </button>
            ) : (
              <button
                disabled={isPending || !connectors[0]}
                onClick={() => connectors[0] && connect({ connector: connectors[0] })}
                className="bg-acid px-4 py-2 text-sm font-semibold text-ink disabled:opacity-50"
              >
                Connect wallet
              </button>
            )}
          </div>
        </div>
        {!marketConfigured && (
          <div
            role="status"
            className="border-t border-amber-300/20 bg-amber-300/5 px-5 py-2 text-center font-mono text-xs text-amber-200"
          >
            BASE SEPOLIA DEPLOYMENT PENDING — write actions are disabled
          </div>
        )}
      </header>
      <main>
        <Outlet />
      </main>
      <footer className="mt-20 border-t border-line px-5 py-8 text-center text-xs leading-6 text-muted">
        <img
          src="/brand/pact-market-logo.png"
          alt=""
          aria-hidden="true"
          className="mx-auto mb-4 h-14 w-auto opacity-60"
        />
        Independent community project using Technocore.
        <br />
        Technocore coordinates. Base settles. No agents or private keys are hosted.
      </footer>
    </div>
  );
}

export function Page({
  eyebrow,
  title,
  copy,
  children,
}: {
  eyebrow: string;
  title: string;
  copy?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mx-auto max-w-7xl px-5 py-12 sm:py-16">
      <div className="mb-10 max-w-3xl">
        <div className="mb-3 font-mono text-xs uppercase tracking-[.2em] text-acid">{eyebrow}</div>
        <h1 className="text-4xl font-semibold tracking-[-.045em] sm:text-5xl">{title}</h1>
        {copy && <p className="mt-4 max-w-2xl text-base leading-7 text-muted">{copy}</p>}
      </div>
      {children}
    </div>
  );
}

export const Card = ({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) => <div className={`border border-line bg-panel/70 p-5 ${className}`}>{children}</div>;
