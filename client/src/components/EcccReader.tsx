import React from 'react';
import type { Location } from '@/lib/weatherTypes';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { AlertItem, ReadableItem } from '@/lib/eccc/types';
import { formatIssued, buildExcerpt } from '@/lib/eccc/parsing';
import type { EcccDataState } from '@/hooks/useEcccData';

type Props = {
  location: Location | null;
  // We can accept the full data state, or just the parts we need. 
  // Accepting the relevant parts is cleaner for component reusability/testing.
  alerts: AlertItem[];
  updates: ReadableItem[];
  forecast: ReadableItem[];
  loading: boolean;
};

export function EcccReader({ location, alerts, updates, forecast, loading }: Props) {
  const isCanadian = !location || !location.country || location.country === 'Canada';

  if (!isCanadian) return null;
  if (!location) return null;

  // If loading and no data, maybe show skeleton? 
  // For now, keeping existing behavior which is ... well, the existing behavior had local state loading.
  // We'll just render what we have.

  return (
    <aside
      aria-label="ECCC Reader"
      className="hidden lg:block max-w-[520px] mt-10"
    >
      <section className="bg-white/[0.03] border border-white/10 rounded-xl p-4">
        <header className="flex items-end justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[11px] tracking-[0.22em] font-medium text-foreground/70">
              ECCC Reader
            </div>
            <div className="text-xs text-foreground/60">
              Environment and Climate Change Canada
            </div>
          </div>
          <div className="text-[11px] text-foreground/60 whitespace-nowrap">
            {location.name}
          </div>
        </header>

        <Tabs defaultValue="updates" className="mt-3 gap-3">
          <TabsList className="w-full grid grid-cols-2 gap-1 bg-white/[0.04] border border-white/10">
            <TabsTrigger value="updates" className="text-xs">
              Updates
              {/* Optional: Show badge count for alerts? */}
            </TabsTrigger>
            <TabsTrigger value="forecast" className="text-xs">
              Forecast
            </TabsTrigger>
          </TabsList>

          <TabsContent value="updates" className="min-h-[180px]">
            {/* Show loading state if empty and loading? */}
            {loading && alerts.length === 0 && updates.length === 0 ? (
              <div className="flex items-center justify-center h-full py-8 text-foreground/50 text-xs">Loading...</div>
            ) : (
              <div className="mt-3 grid gap-3">
                {alerts.map((alert) => (
                  <article
                    key={alert.id}
                    className="rounded-lg border border-white/10 bg-white/[0.04] p-3"
                  >
                    <div className="text-xs font-semibold text-foreground">
                      {alert.headline || alert.event}
                    </div>
                    <div className="mt-1 text-[11px] text-foreground/60">
                      {alert.sent_at ? `Issued ${formatIssued(alert.sent_at)}` : ''}
                    </div>
                    <p className="mt-2 text-xs text-foreground/80 line-clamp-2">
                      {buildExcerpt(alert.description || alert.instruction || alert.event)}
                    </p>
                    {alert.source_url && (
                      <a
                        className="mt-2 inline-flex text-[11px] text-foreground/60 underline underline-offset-2 hover:text-foreground"
                        href={alert.source_url}
                        target="_blank"
                        rel="noopener"
                      >
                        Open source
                      </a>
                    )}
                  </article>
                ))}
                {updates.map((item) => (
                  <article
                    key={item.id}
                    className="rounded-lg border border-white/10 bg-white/[0.04] p-3"
                  >
                    <div className="text-xs font-semibold text-foreground">
                      {item.title}
                    </div>
                    <div className="mt-1 text-[11px] text-foreground/60">
                      {item.issued_at ? `Issued ${formatIssued(item.issued_at)}` : ''}
                    </div>
                    <p className="mt-2 text-xs text-foreground/80 line-clamp-2">
                      {buildExcerpt(item.body_text)}
                    </p>
                    <a
                      className="mt-2 inline-flex text-[11px] text-foreground/60 underline underline-offset-2 hover:text-foreground"
                      href={item.source_url}
                      target="_blank"
                      rel="noopener"
                    >
                      Open source
                    </a>
                  </article>
                ))}

                {alerts.length === 0 && updates.length === 0 && (
                  <div className="text-center py-8 text-foreground/40 text-xs">
                    No active alerts or updates.
                  </div>
                )}
              </div>
            )}
          </TabsContent>
          <TabsContent value="forecast" className="min-h-[180px]">
            {loading && forecast.length === 0 ? (
              <div className="flex items-center justify-center h-full py-8 text-foreground/50 text-xs">Loading...</div>
            ) : (
              <div className="mt-3 grid gap-3">
                {forecast.map((item) => (
                  <article
                    key={item.id}
                    className="rounded-lg border border-white/10 bg-white/[0.04] p-3"
                  >
                    <div className="text-xs font-semibold text-foreground">
                      {item.title}
                    </div>
                    <div className="mt-1 text-[11px] text-foreground/60">
                      {item.issued_at ? `Issued ${formatIssued(item.issued_at)}` : ''}
                    </div>
                    <p className="mt-2 text-xs text-foreground/80 line-clamp-2">
                      {buildExcerpt(item.body_text)}
                    </p>
                    <a
                      className="mt-2 inline-flex text-[11px] text-foreground/60 underline underline-offset-2 hover:text-foreground"
                      href={item.source_url}
                      target="_blank"
                      rel="noopener"
                    >
                      Open source
                    </a>
                  </article>
                ))}
                {forecast.length === 0 && (
                  <div className="text-center py-8 text-foreground/40 text-xs">
                    No forecast data availability.
                  </div>
                )}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </section>
    </aside>
  );
}
