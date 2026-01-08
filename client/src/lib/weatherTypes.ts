export interface WeatherModel {
    id: string;
    name: string;
    provider: string;
    endpoint: string;
    color: string;
    description: string;
    metadataId?: string;
}

export interface HourlyForecast {
    time: string;
    temperature: number;
    precipitation: number;
    precipitationProbability: number;
    windSpeed: number;
    windDirection: number;
    windGusts: number;
    cloudCover: number;
    humidity: number;
    pressure: number;
    weatherCode: number;
}

export interface DailyForecast {
    date: string;
    temperatureMax: number;
    temperatureMin: number;
    precipitationSum: number;
    precipitationProbabilityMax: number;
    windSpeedMax: number;
    windGustsMax: number;
    weatherCode: number;
    sunrise: string;
    sunset: string;
}

export interface ModelForecast {
    model: WeatherModel;
    hourly: HourlyForecast[];
    daily: DailyForecast[];
    fetchedAt: Date;
    runInitialisationTime?: number;
    runAvailabilityTime?: number;
    updateIntervalSeconds?: number;
    metadataFetchedAt?: number;
    snapshotTime?: number;
    lastForecastFetchTime?: number;
    lastSeenRunAvailabilityTime?: number | null;
    lastForecastSnapshotId?: string;
    snapshotHash?: string;
    etag?: string;
    pendingAvailabilityTime?: number;
    updateError?: string;
    error?: string;
}

export interface ModelMetadata {
    runInitialisationTime?: number;
    runAvailabilityTime?: number;
    updateIntervalSeconds?: number;
    metadataFetchedAt?: number;
}

export interface ObservedHourly {
    time: string;
    temperature: number;
    precipitation?: number;
    windSpeed?: number;
    windDirection?: number;
    windGusts?: number;
}

export interface ObservedConditions {
    hourly: ObservedHourly[];
    fetchedAt: Date;
    error?: string;
}

export interface Location {
    name: string;
    latitude: number;
    longitude: number;
    country: string;
    province?: string;
    timezone: string;
}
