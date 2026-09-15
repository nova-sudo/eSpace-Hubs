"use client";

/**
 * The admin portal's own chrome: a left rail listing every admin
 * section, with the page's content beside it.
 *
 * Why the hub needs one. The admin surfaces are a settings area, not a
 * set of peer dashboards — Vercel, Linear and Auth0 all give that shape
 * a sidebar. More concretely: `/admin` and `/admin/hub-config` used to
 * be suppressed from the top nav, which left hub configuration
 * reachable only from a page you could not navigate to. The rail lists
 * the sections unconditionally, and the top nav now shows them too, so
 * the two agree.
 *
 * Only the admin hub mounts this — every other hub keeps the plain
 * full-width page chrome.
 *
 * Sections are filtered through the active hub's effective `pages` map,
 * so a slot an org hid in hub config disappears from the rail as well
 * as the nav.
 */

import Link from "next/link";
import { LayoutDashboard, LayoutGrid, ScrollText, Settings, Users } from "lucide-react";
import { Label } from "@/components/ui";
import { useActiveHub, useHubLink } from "@/features/hubs";
import { cn } from "@/lib/cn";

/** slot → rail entry. Order here is the order on screen. */
const SECTIONS = [
  { slot: "dashboard", label: "Overview", subpath: "", icon: LayoutDashboard },
  { slot: "users", label: "Members", subpath: "/users", icon: Users },
  { slot: "hub-config", label: "Hubs & pages", subpath: "/hub-config", icon: LayoutGrid },
  { slot: "audit", label: "Audit log", subpath: "/audit", icon: ScrollText },
  { slot: "settings", label: "Settings", subpath: "/settings", icon: Settings },
];

export function AdminShell({ active, children }) {
  const hub = useActiveHub();
  const link = useHubLink();

  // Before the hub resolves, show every section rather than an empty
  // rail — the links are inert for a beat, never missing.
  const sections = SECTIONS.filter((s) => !hub || Boolean(hub.pages?.[s.slot]));

  return (
    <main className="mx-auto max-w-[1280px] px-4 pb-16 pt-7 sm:px-10">
      <div className="grid gap-6 lg:grid-cols-[212px_minmax(0,1fr)] lg:gap-7">
        <nav aria-label="Admin sections" className="lg:sticky lg:top-[88px] lg:self-start">
          <div className="hidden lg:block">
            <Label className="mb-2 block px-3">Administration</Label>
          </div>
          <div
            className="flex gap-1 overflow-x-auto rounded-[var(--radius-xl)] bg-card p-1.5 lg:flex-col lg:overflow-visible"
            style={{ boxShadow: "var(--shadow-card)" }}
          >
            {sections.map((section) => {
              const Icon = section.icon;
              const isActive = section.slot === active;
              return (
                <Link
                  key={section.slot}
                  href={link(section.subpath)}
                  aria-current={isActive ? "page" : undefined}
                  className={cn(
                    "inline-flex shrink-0 items-center gap-2.5 whitespace-nowrap rounded-[var(--radius-md)] px-3 py-2 text-[13px] transition-colors lg:w-full",
                    isActive
                      ? "bg-card-alt font-bold text-fg"
                      : "font-semibold text-muted-fg hover:bg-card-alt hover:text-fg",
                  )}
                >
                  <Icon size={15} className={isActive ? "text-fg" : "text-dim-fg"} />
                  {section.label}
                </Link>
              );
            })}
          </div>
        </nav>
        <div className="min-w-0">{children}</div>
      </div>
    </main>
  );
}

/**
 * The "Not authorised." body, wrapped in the same rail so a member who
 * can reach the hub but not one page inside it can still navigate away.
 */
export function AdminNotAuthorised({ active, crumb, capability }) {
  return (
    <AdminShell active={active}>
      <div>
        <Label>{crumb}</Label>
        <h1 className="mt-3.5 text-[40px] font-extrabold leading-[1.05] tracking-[-0.03em] text-fg">
          Not authorised.
        </h1>
        <p className="mt-3 max-w-[560px] text-[14.5px] leading-[1.55] text-muted-fg">
          This view requires the <span className="font-mono">{capability}</span>{" "}
          capability. Ask your org admin to extend your roles.
        </p>
      </div>
    </AdminShell>
  );
}
