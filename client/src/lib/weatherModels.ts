import { type WeatherModel } from './weatherTypes';

// Weather models configuration - focused on Canadian context
export const WEATHER_MODELS: WeatherModel[] = [
    {
        id: 'gem_seamless',
        name: 'GEM',
        provider: 'Environment Canada',
        endpoint: 'https://api.open-meteo.com/v1/gem',
        color: 'oklch(0.75 0.15 195)', // Arctic cyan
        description: 'Canadian Global Environmental Multiscale Model - Primary for Canada',
        metadataId: 'cmc_gem_gdps'
    },
    {
        id: 'gfs_seamless',
        name: 'GFS',
        provider: 'NOAA (US)',
        endpoint: 'https://api.open-meteo.com/v1/gfs',
        color: 'oklch(0.70 0.16 280)', // Purple
        description: 'Global Forecast System - US model with global coverage',
        metadataId: 'ncep_gfs013'
    },
    {
        id: 'ecmwf_ifs',
        name: 'ECMWF',
        provider: 'European Centre',
        endpoint: 'https://api.open-meteo.com/v1/ecmwf',
        color: 'oklch(0.72 0.19 160)', // Green
        description: 'European model - IFS HRES 9 km global forecast',
        metadataId: 'ecmwf_ifs'
    },
    {
        id: 'icon_seamless',
        name: 'ICON',
        provider: 'DWD (Germany)',
        endpoint: 'https://api.open-meteo.com/v1/dwd-icon',
        color: 'oklch(0.75 0.18 85)', // Amber
        description: 'German Icosahedral Nonhydrostatic model',
        metadataId: 'dwd_icon'
    }
];
