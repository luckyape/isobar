/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useMemo, useRef, type ReactNode } from 'react';
import {
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts';
import { Cloud, Droplets, Thermometer, Wind, X } from 'lucide-react';
import type { ModelForecast } from '@/lib/weatherApi';
import { normalizeWeatherCode, WEATHER_CODES } from '@/lib/weatherApi';
import { WeatherIcon } from '@/components/icons/WeatherIcon';
import { conditionToIconName } from '@/lib/weatherIcons';
import { getIsDay } from '@/lib/dayNight';
import {
  findCurrentHourIndex,
  formatHourLabel,
  formatWeekdayHourLabel,
  parseOpenMeteoDateTime
} from '@/lib/timeUtils';
import { cn } from '@/lib/utils';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { DialogClose } from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '@/components/ui/table';
import { HourlyWeatherBugCard } from '@/components/HourlyWeatherBugCard';
import { ModelEmblem } from '@/components/ModelEmblem';

type TimeSlot = {
  time: string;
  label: string;
  fullLabel: string;
  isCurrent: boolean;
  isPast: boolean;
  hour: ModelForecast['hourly'][number];
};

function formatTemp(value: number | null | undefined): string {
  if (!Number.isFinite(value ?? NaN)) return '--';
  const rounded = Math.round((value as number) * 10) / 10;
  return `${rounded.toFixed(1)}°`;
}

function formatPercent(value: number | null | undefined): string {
  if (!Number.isFinite(value ?? NaN)) return '--';
  return `${Math.round(value as number)}%`;
}

function formatMmPerHour(value: number | null | undefined): string {
  if (!Number.isFinite(value ?? NaN)) return '--';
  const amount = value as number;
  if (amount >= 0 && amount < 0.05) return '<0.1';
  return `${Math.round(amount * 10) / 10}`;
}

function formatWind(value: number | null | undefined): string {
  if (!Number.isFinite(value ?? NaN)) return '--';
  return `${Math.round(value as number)}`;
}

function windDirectionLabel(degrees: number | null | undefined): string {
  if (!Number.isFinite(degrees ?? NaN)) return '--';
  const value = ((degrees as number) % 360 + 360) % 360;
  const directions = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  const index = Math.round(value / 45) % directions.length;
  return directions[index];
}

function getWeatherInfo(
  code: number | null | undefined,
  epoch?: number,
  timezone?: string
) {
  const normalized = normalizeWeatherCode(code);
  if (!Number.isFinite(normalized)) return null;
  const isDay = epoch ? getIsDay(epoch, undefined, timezone) : true;
  const iconName = conditionToIconName(normalized, isDay);
  return {
    iconName,
    description: WEATHER_CODES[normalized]?.description || 'Unknown'
  };
}

function buildTimeSlots({
  forecast,
  timezone
}: {
  forecast: ModelForecast;
  timezone?: string;
}): TimeSlot[] {
  const times = forecast.hourly.map((hour) => hour.time);
  if (times.length === 0) return [];

  const currentIndex = findCurrentHourIndex(times, timezone);
  const maxWindowHours = 48;
  const maxPastHours = 24;
  const pastHours = Math.min(maxPastHours, currentIndex);
  const futureHours = maxWindowHours - pastHours;
  const startIndex = Math.max(0, currentIndex - pastHours);
  const endIndex = Math.min(times.length, currentIndex + futureHours + 1);
  const windowHours = forecast.hourly.slice(startIndex, endIndex);
  const currentTimeKey = times[currentIndex] ?? null;

  let foundCurrent = false;
  return windowHours.map((hour) => {
    const parts = parseOpenMeteoDateTime(hour.time);
    const isCurrent = Boolean(currentTimeKey && hour.time === currentTimeKey);
    if (isCurrent) foundCurrent = true;
    const isPast = !foundCurrent && !isCurrent;
    return {
      time: hour.time,
      label: parts ? formatHourLabel(parts) : hour.time,
      fullLabel: parts ? formatWeekdayHourLabel(parts) : hour.time,
      isCurrent,
      isPast,
      hour
    };
  });
}

function ChartCard({
  title,
  icon: Icon,
  children
}: {
  title: string;
  icon: typeof Thermometer;
  children: ReactNode;
}) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.02] p-3 sm:p-4">
      <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-foreground/70">
        <Icon className="h-4 w-4" />
        <span>{title}</span>
      </div>
      {children}
    </div>
  );
}

export function ModelForecastDrilldownPanel({
  forecast,
  timezone,
  className
}: {
  forecast: ModelForecast;
  timezone?: string;
  className?: string;
}) {
  const timeSlots = useMemo(() => buildTimeSlots({ forecast, timezone }), [forecast, timezone]);
  const currentHourRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const stickyHeaderRef = useRef<HTMLDivElement>(null);
  const hasAutoScrolledRef = useRef(false);

  // Auto-scroll to current hour on mount (align to top under sticky header).
  useEffect(() => {
    if (hasAutoScrolledRef.current) return;

    const scrollContainer = scrollContainerRef.current;
    const stickyHeader = stickyHeaderRef.current;
    const target = currentHourRef.current;
    if (!scrollContainer || !target) return;

    hasAutoScrolledRef.current = true;

    requestAnimationFrame(() => {
      const headerHeight = stickyHeader?.getBoundingClientRect().height ?? 0;
      const containerRect = scrollContainer.getBoundingClientRect();
      const targetRect = target.getBoundingClientRect();
      const targetTop = scrollContainer.scrollTop + (targetRect.top - containerRect.top);
      scrollContainer.scrollTo({
        top: Math.max(0, targetTop - headerHeight),
        behavior: 'smooth'
      });
    });
  }, [timeSlots]);

  const chartData = useMemo(
    () =>
      timeSlots.map((slot) => ({
        time: slot.time,
        label: slot.label,
        fullLabel: slot.fullLabel,
        temperature: slot.hour.temperature,
        precipitationProbability: slot.hour.precipitationProbability,
        precipitation: slot.hour.precipitation,
        windSpeed: slot.hour.windSpeed,
        windGusts: slot.hour.windGusts
      })),
    [timeSlots]
  );
  const modelColor = forecast.model.color;
  const conditionSamples = useMemo(
    () => timeSlots.filter((_, index) => index % 3 === 0),
    [timeSlots]
  );



  return (
    <div
      ref={scrollContainerRef}
      className={cn('h-full min-w-0 min-h-0 overflow-y-auto scrollbar-arctic', className)}
    >
      <Tabs defaultValue="bug" className="min-w-0 gap-0">
        <div
          ref={stickyHeaderRef}
          className={cn(
            'sticky top-0 z-20',
            'bg-background/90 backdrop-blur-xl',
            'border-b border-white/10',
            'px-4 py-4 sm:px-6 sm:py-6'
          )}
        >
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <ModelEmblem
                model={forecast.model}
                className="gap-2"
                textClassName="text-base font-semibold leading-none"
              />
              <p className="mt-1 text-xs text-foreground/70">
                {forecast.model.provider}
              </p>
            </div>

            <DialogClose asChild>
              <button
                type="button"
                aria-label="Close"
                className={cn(
                  'shrink-0 rounded-md p-2 text-foreground/60 transition-colors',
                  'hover:bg-white/[0.04] hover:text-foreground',
                  'focus-visible:ring-2 focus-visible:ring-white/30'
                )}
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </DialogClose>
          </div>

          <TabsList className="mt-4 bg-white/[0.04]">
            <TabsTrigger value="bug" className="text-xs">
              Heads-Up
            </TabsTrigger>
            <TabsTrigger value="chart" className="text-xs">
              Chart
            </TabsTrigger>
            <TabsTrigger value="table" className="text-xs">
              Table
            </TabsTrigger>
          </TabsList>
        </div>

        <div className="px-4 py-4 sm:px-6 sm:py-6">
          <TabsContent value="bug" className="min-w-0">
            <div className="space-y-2">
              {timeSlots.map((slot) => (
                <div
                  key={slot.time}
                  ref={slot.isCurrent ? currentHourRef : undefined}
                  className="content-visibility-auto"
                >
                  <HourlyWeatherBugCard
                    hour={slot.hour}
                    fullLabel={slot.fullLabel}
                    isCurrent={slot.isCurrent}
                    isPast={slot.isPast}
                    accentColor={modelColor}
                  />
                </div>
              ))}
            </div>
          </TabsContent>

          <TabsContent value="chart" className="min-w-0 w-full">
            <div className="grid gap-3 sm:gap-4 w-full">
              <ChartCard title="Temperature" icon={Thermometer}>
                <div className="h-40 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                      <XAxis
                        dataKey="label"
                        interval="preserveStartEnd"
                        minTickGap={30}
                        tick={{ fill: 'oklch(0.95 0.01 240 / 0.6)', fontSize: 11 }}
                        axisLine={false}
                        tickLine={false}
                      />
                      <YAxis
                        tick={{ fill: 'oklch(0.95 0.01 240 / 0.6)', fontSize: 11 }}
                        axisLine={false}
                        tickLine={false}
                        width={32}
                      />
                      <Tooltip
                        cursor={{ stroke: 'oklch(0.95 0.01 240 / 0.15)' }}
                        contentStyle={{
                          background: 'oklch(0.12 0.02 240 / 0.92)',
                          border: '1px solid oklch(1 0 0 / 0.08)',
                          borderRadius: 10
                        }}
                        labelStyle={{ color: 'oklch(0.95 0.01 240 / 0.8)' }}
                        formatter={(value: any) => formatTemp(value)}
                        labelFormatter={(_, payload) => payload?.[0]?.payload?.fullLabel ?? ''}
                      />
                      <Line
                        type="monotone"
                        dataKey="temperature"
                        stroke={modelColor}
                        strokeWidth={2}
                        dot={false}
                        strokeOpacity={0.9}
                      />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              </ChartCard>

              <ChartCard title="Precipitation" icon={Droplets}>
                <div className="h-40 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                      <XAxis
                        dataKey="label"
                        interval="preserveStartEnd"
                        minTickGap={30}
                        tick={{ fill: 'oklch(0.95 0.01 240 / 0.6)', fontSize: 11 }}
                        axisLine={false}
                        tickLine={false}
                      />
                      <YAxis
                        yAxisId="pop"
                        tick={{ fill: 'oklch(0.95 0.01 240 / 0.6)', fontSize: 11 }}
                        axisLine={false}
                        tickLine={false}
                        width={32}
                        domain={[0, 100]}
                      />
                      <Tooltip
                        cursor={{ stroke: 'oklch(0.95 0.01 240 / 0.15)' }}
                        contentStyle={{
                          background: 'oklch(0.12 0.02 240 / 0.92)',
                          border: '1px solid oklch(1 0 0 / 0.08)',
                          borderRadius: 10
                        }}
                        labelStyle={{ color: 'oklch(0.95 0.01 240 / 0.8)' }}
                        formatter={(value: any, name: any) => {
                          if (name === 'precipitationProbability') return formatPercent(value);
                          if (name === 'precipitation') return `${formatMmPerHour(value)} mm/hr`;
                          return String(value ?? '');
                        }}
                        labelFormatter={(_, payload) => payload?.[0]?.payload?.fullLabel ?? ''}
                      />
                      <Line
                        type="monotone"
                        yAxisId="pop"
                        dataKey="precipitationProbability"
                        stroke={modelColor}
                        strokeWidth={2}
                        dot={false}
                        strokeOpacity={0.85}
                      />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
                <p className="mt-2 text-[11px] text-foreground/60">
                  POP shown (%). Use table view for intensity (mm/hr).
                </p>
              </ChartCard>

              <ChartCard title="Wind" icon={Wind}>
                <div className="h-40 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                      <XAxis
                        dataKey="label"
                        interval="preserveStartEnd"
                        minTickGap={30}
                        tick={{ fill: 'oklch(0.95 0.01 240 / 0.6)', fontSize: 11 }}
                        axisLine={false}
                        tickLine={false}
                      />
                      <YAxis
                        tick={{ fill: 'oklch(0.95 0.01 240 / 0.6)', fontSize: 11 }}
                        axisLine={false}
                        tickLine={false}
                        width={32}
                      />
                      <Tooltip
                        cursor={{ stroke: 'oklch(0.95 0.01 240 / 0.15)' }}
                        contentStyle={{
                          background: 'oklch(0.12 0.02 240 / 0.92)',
                          border: '1px solid oklch(1 0 0 / 0.08)',
                          borderRadius: 10
                        }}
                        labelStyle={{ color: 'oklch(0.95 0.01 240 / 0.8)' }}
                        formatter={(value: any, name: any) => {
                          if (name === 'windSpeed') return `${formatWind(value)} km/h`;
                          if (name === 'windGusts') return `${formatWind(value)} km/h`;
                          return String(value ?? '');
                        }}
                        labelFormatter={(_, payload) => payload?.[0]?.payload?.fullLabel ?? ''}
                      />
                      <Line
                        type="monotone"
                        dataKey="windSpeed"
                        stroke={modelColor}
                        strokeWidth={2}
                        dot={false}
                        strokeOpacity={0.85}
                      />
                      <Line
                        type="monotone"
                        dataKey="windGusts"
                        stroke={modelColor}
                        strokeWidth={2}
                        dot={false}
                        strokeOpacity={0.35}
                        strokeDasharray="4 4"
                      />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
                <p className="mt-2 text-[11px] text-foreground/60">
                  Solid = speed, dashed = gusts.
                </p>
              </ChartCard>

              <ChartCard title="Conditions" icon={Cloud}>
                <div className="flex flex-wrap justify-center gap-3 pb-2">
                  {conditionSamples.map((slot) => {
                    const epoch = new Date(slot.time).getTime() / 1000;
                    const info = getWeatherInfo(slot.hour.weatherCode, epoch, timezone);
                    return (
                      <div
                        key={slot.time}
                        className={cn(
                          'flex min-w-[3.25rem] flex-col items-center rounded-md border border-white/10 bg-white/[0.02] px-2 py-1.5',
                          slot.isCurrent && 'border-white/20 bg-white/[0.04]'
                        )}
                      >
                        <span className="text-[10px] text-foreground/70">{slot.label}</span>
                        <span className="text-lg leading-none h-6 w-6">
                          {info?.iconName ? <WeatherIcon name={info.iconName} className="h-full w-full" /> : '—'}
                        </span>
                        <span className="mt-1 text-[10px] text-foreground/60 line-clamp-1">
                          {info?.description ?? '—'}
                        </span>
                      </div>
                    );
                  })}
                </div>
                <p className="mt-2 text-[11px] text-foreground/60">
                  Sampled every 3 hours.
                </p>
              </ChartCard>
            </div>
          </TabsContent>

          <TabsContent value="table" className="min-w-0">
            <div className="rounded-lg border border-white/10 bg-white/[0.02] overflow-x-auto">
              <Table className="min-w-max">
                <TableHeader>
                  <TableRow>
                    <TableHead>Time</TableHead>
                    <TableHead>Temp</TableHead>
                    <TableHead>POP</TableHead>
                    <TableHead>Intensity</TableHead>
                    <TableHead>Wind</TableHead>
                    <TableHead>Gust</TableHead>
                    <TableHead>Dir</TableHead>
                    <TableHead>Cond</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {timeSlots.map((slot) => {
                    const epoch = new Date(slot.time).getTime() / 1000;
                    const info = getWeatherInfo(slot.hour.weatherCode, epoch, timezone);
                    return (
                      <TableRow
                        key={slot.time}
                        className={cn(slot.isCurrent && 'bg-white/[0.04]')}
                      >
                        <TableCell className="text-xs text-foreground/70">
                          {slot.fullLabel}
                        </TableCell>
                        <TableCell className="font-mono tabular-nums">
                          {formatTemp(slot.hour.temperature)}
                        </TableCell>
                        <TableCell className="font-mono tabular-nums">
                          {formatPercent(slot.hour.precipitationProbability)}
                        </TableCell>
                        <TableCell className="font-mono tabular-nums">
                          {formatMmPerHour(slot.hour.precipitation)}
                        </TableCell>
                        <TableCell className="font-mono tabular-nums">
                          {formatWind(slot.hour.windSpeed)}
                        </TableCell>
                        <TableCell className="font-mono tabular-nums">
                          {formatWind(slot.hour.windGusts)}
                        </TableCell>
                        <TableCell className="font-mono tabular-nums">
                          {windDirectionLabel(slot.hour.windDirection)}
                        </TableCell>
                        <TableCell className="text-xs flex items-center gap-1.5">
                          <span className="h-4 w-4 shrink-0">
                            {info?.iconName ? <WeatherIcon name={info.iconName} className="h-full w-full" /> : '—'}
                          </span>
                          <span className="text-foreground/80">{info?.description ?? '—'}</span>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </TabsContent>
        </div>
      </Tabs>
    </div>
  );
}
