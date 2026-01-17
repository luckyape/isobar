import React from 'react';
import { motion } from 'framer-motion';
import { type ModelForecast } from '@/lib/weatherApi';
import { ModelCard } from '@/components/ModelCard';

interface IndividualModelForecastsProps {
    forecasts: ModelForecast[];
    staleModelIds?: Set<string>;
    timezone?: string;
}

export function IndividualModelForecasts({
    forecasts,
    staleModelIds,
    timezone
}: IndividualModelForecastsProps) {
    // Guard: If no forecasts, render nothing (extra safety)
    if (!forecasts || forecasts.length === 0) {
        return null;
    }

    return (
        <motion.section
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4 }}
        >
            <h2 className="text-xl font-semibold">Individual Model Forecasts</h2>
            <p className="text-sm text-foreground/70 mb-4">
                Current-hour conditions per model, plus today's high/low.
            </p>
            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {forecasts.map((forecast, index) => (
                    <ModelCard
                        key={forecast.model.id}
                        forecast={forecast}
                        index={index}
                        isStale={staleModelIds?.has(forecast.model.id)}
                        timezone={timezone}
                    />
                ))}
            </div>
        </motion.section>
    );
}
