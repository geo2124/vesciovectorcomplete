import { initSentryMonitoring, recordDiagnosticAndCaptureSentry } from "@/lib/sentry-init";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "@/lib/theme";
import { DataProvider } from "@/lib/data-store";
import { AppearanceSync } from "@/lib/appearance";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";

initSentryMonitoring();

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
    recordDiagnosticAndCaptureSentry(error, {
      source: "react_error_boundary",
      operation: "RootErrorComponent",
    });

    if (typeof window !== "undefined") {
      const msg = String(error?.message || error || "").toLowerCase();
      const isChunkError =
        msg.includes("failed to fetch dynamically imported module") ||
        msg.includes("importing a module script failed") ||
        msg.includes("error loading dynamically imported module") ||
        msg.includes("chunkloaderror") ||
        msg.includes("unable to preload css");

      if (isChunkError) {
        const reloadKey = "vv_chunk_reload_attempted";
        const lastAttempt = Number(window.sessionStorage.getItem(reloadKey) || "0");
        if (Date.now() - lastAttempt > 15000) {
          window.sessionStorage.setItem(reloadKey, String(Date.now()));
          Promise.resolve()
            .then(async () => {
              if ("serviceWorker" in navigator) {
                const regs = await navigator.serviceWorker.getRegistrations();
                await Promise.all(regs.map((r) => r.unregister()));
              }
              if ("caches" in window) {
                const keys = await window.caches.keys();
                await Promise.all(keys.map((k) => window.caches.delete(k)));
              }
            })
            .catch(() => {})
            .finally(() => {
              window.location.reload();
            });
        }
      }
    }
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          This page didn't load
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Something went wrong on our end. You can try refreshing or head back home.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Try again
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Go home
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Vescio Vector — Basketball Academy Management" },
      {
        name: "description",
        content:
          "Vescio Vector is a cloud platform for running basketball academies: players, teams, sessions, attendance, merchandise and accounting.",
      },
      { property: "og:title", content: "Vescio Vector" },
      {
        property: "og:description",
        content:
          "Cloud platform for running basketball academies: players, teams, sessions, attendance, merchandise and accounting.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "theme-color", content: "#f97316" },
      { name: "mobile-web-app-capable", content: "yes" },
      { name: "apple-mobile-web-app-capable", content: "yes" },
      { name: "apple-mobile-web-app-status-bar-style", content: "black-translucent" },
      { name: "apple-mobile-web-app-title", content: "VescioVector" },
    ],
    links: [
      {
        rel: "stylesheet",
        href: appCss,
      },
      { rel: "manifest", href: "/manifest.webmanifest" },
      { rel: "apple-touch-icon", href: "/apple-touch-icon.png" },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Archivo+Black&family=Space+Grotesk:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;700&display=swap",
      },
      { rel: "icon", href: "/vescio-vector-logo.png", type: "image/png" },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  const isDevMode = Boolean(import.meta.env.DEV);
  return (
    <html lang="en" suppressHydrationWarning>
      <head suppressHydrationWarning>
        <HeadContent />
        <script
          dangerouslySetInnerHTML={{
            __html: `
              try {
                if ('serviceWorker' in navigator && window.location.protocol.startsWith('http')) {
                  var host = window.location.hostname || '';
                  var isPreviewOrDev = ${isDevMode ? "true" : "false"} || host.indexOf('run.app') !== -1 || host === 'localhost' || host === '127.0.0.1';
                  if (isPreviewOrDev) {
                    navigator.serviceWorker.getRegistrations().then(function(regs) {
                      for (var i = 0; i < regs.length; i++) {
                        try { regs[i].unregister().catch(function() {}); } catch (e) {}
                      }
                    }).catch(function() {});
                  } else {
                    window.addEventListener('load', function() {
                      fetch('/sw.js', { method: 'HEAD', cache: 'no-store' })
                        .then(function(res) {
                          var ct = (res && res.headers && res.headers.get('content-type')) || '';
                          if (res && res.ok && ct.toLowerCase().indexOf('javascript') !== -1) {
                            return navigator.serviceWorker.register('/sw.js').then(function(reg) {
                              if (reg && typeof reg.update === 'function') {
                                Promise.resolve(reg.update()).catch(function() {});
                              }
                            });
                          }
                        })
                        .catch(function() {});
                    });
                  }
                }

                var stored = window.localStorage.getItem("vv-theme");
                var isLight = stored === "light";
                if (isLight) {
                  document.documentElement.classList.add("light");
                  document.documentElement.classList.remove("dark");
                  document.documentElement.style.colorScheme = "light";
                } else {
                  document.documentElement.classList.add("dark");
                  document.documentElement.classList.remove("light");
                  document.documentElement.style.colorScheme = "dark";
                }
              } catch (e) {}
            `,
          }}
        />
      </head>
      <body suppressHydrationWarning>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

import { AuthProvider } from "@/lib/auth";
import { Toaster } from "@/components/ui/sonner";
import { DevDiagnosticsPill } from "@/components/dev-diagnostics-pill";
import { RbaDemoControlBar } from "@/components/rba-demo-control-bar";

function RootComponent() {
  const { queryClient } = Route.useRouteContext();

  useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
    const host = window.location.hostname || "";
    const isPreviewOrDev =
      import.meta.env.DEV ||
      host.includes("run.app") ||
      host === "localhost" ||
      host === "127.0.0.1";
    if (!isPreviewOrDev) return;

    (async () => {
      try {
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map((reg) => reg.unregister().catch(() => false)));
      } catch {
        /* Silently ignore stale serviceWorker cleanup errors */
      }
    })();
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <AuthProvider>
          <DataProvider>
            <AppearanceSync />
            {/* Required: nested routes render here. Removing <Outlet /> breaks all child routes. */}
            <Outlet />
            <RbaDemoControlBar />
            <DevDiagnosticsPill />
            <Toaster />
          </DataProvider>
        </AuthProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
