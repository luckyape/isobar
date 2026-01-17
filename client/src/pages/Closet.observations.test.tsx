
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import ClosetDashboardPage from './Closet.tsx';
import * as locationStore from '@/lib/locationStore';
import * as observations from '@/lib/observations/observations';
import * as closetOps from '@/lib/closet/ops';
import { getClosetDB } from '@/lib/closet';

// Mock dependencies
vi.mock('@/lib/locationStore', () => ({
    subscribeToLocationChanges: vi.fn((cb) => {
        cb(); // Call immediately
        return () => { };
    }),
    getLocationSnapshot: vi.fn(),
}));

vi.mock('@/lib/observations/observations', () => ({
    getLatestObservation: vi.fn(),
    // Keep types working if possible, else mock export
}));

vi.mock('@/lib/closet/ops', () => ({
    computeOpsSnapshot: vi.fn().mockResolvedValue({
        totalBytesPresent: 1024,
        quotaBytes: 1000000,
        headroomBytes: 500000,
        lastGcAt: Date.now(),
        presentBlobsCount: 10,
        pinnedBlobsCount: 5,
        topBlobsBySize: [],
    }),
    getDefaultClosetPolicy: () => ({}),
    isTrustedMode: () => false,
}));

vi.mock('@/hooks/useClosetUrlState', () => ({
    useClosetUrlState: () => [{ expandedSections: new Set(['last-observation']), jsonOpen: false }, vi.fn()],
    toggleSection: vi.fn(),
}));

// Mock ClosetDB
vi.mock('@/lib/closet', async () => {
    const actual = await vi.importActual('@/lib/closet');
    return {
        ...actual,
        getClosetDB: vi.fn().mockReturnValue({
            open: vi.fn().mockResolvedValue(undefined),
            getAllObservationIndexEntries: vi.fn().mockResolvedValue([]),
            getAllForecastIndexEntries: vi.fn().mockResolvedValue([]),
            getAllInflight: vi.fn().mockResolvedValue([]),
        }),
    };
});

describe('Closet Dashboard - Last Observation Tab', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('renders "No recent data" when no observations exist', async () => {
        // Setup mocks
        (locationStore.getLocationSnapshot as any).mockReturnValue({
            primaryLocation: { name: 'Toronto', latitude: 43.7, longitude: -79.4 },
        });
        (observations.getLatestObservation as any).mockResolvedValue(null);

        render(<ClosetDashboardPage />);

        await waitFor(() => {
            expect(screen.getByText('Last Observation')).toBeTruthy();
        });

        expect(screen.getByText('No recent data')).toBeTruthy();
    });

    it('renders observation data when available', async () => {
        const fixedTimestamp = Date.now() - 3600000; // 1 hour ago
        const mockObsData = {
            stationId: 'stn123',
            stationName: 'Test Station',
            distanceKm: 5.2,
            series: {
                buckets: [fixedTimestamp],
                tempC: [22.5],
                windKph: [15],
                precipMm: [0],
            },
            trust: { mode: 'unverified', verifiedCount: 0, unverifiedCount: 1 }
        };

        (locationStore.getLocationSnapshot as any).mockReturnValue({
            primaryLocation: { name: 'Toronto', latitude: 43.7, longitude: -79.4 },
        });
        (observations.getLatestObservation as any).mockResolvedValue(mockObsData);

        render(<ClosetDashboardPage />);

        await waitFor(() => {
            expect(screen.getByText('Fresh data available')).toBeTruthy();
        });

        // Check for values
        expect(screen.getByText('22.5°')).toBeTruthy();
        expect(screen.getAllByText('Test Station').length).toBeGreaterThan(0);
        expect(screen.getByText('5.20 km')).toBeTruthy();

        // Verify timestamp display
        // The component uses toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        const expectedTimeStr = new Date(fixedTimestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        expect(screen.getAllByText(expectedTimeStr).length).toBeGreaterThan(0);
    });
});
