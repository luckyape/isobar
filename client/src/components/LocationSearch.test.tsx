import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LocationSearch } from './LocationSearch';
import { hasEverSetPrimary, markPrimaryAsSet } from '@/lib/locationStore';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { CANADIAN_CITIES } from '@/lib/weatherApi';
import { toast } from 'sonner';

// Mock dependencies
vi.mock('@/lib/locationStore', () => ({
    hasEverSetPrimary: vi.fn(),
    markPrimaryAsSet: vi.fn(),
}));

vi.mock('@/hooks/useMediaQuery', () => ({
    useMediaQuery: vi.fn(),
}));

vi.mock('sonner', () => ({
    toast: {
        success: vi.fn(),
    },
}));

// Mock ResizeObserver for Radix UI
global.ResizeObserver = class ResizeObserver {
    observe() { }
    unobserve() { }
    disconnect() { }
};

// Mock scrollIntoView for cmdk
window.HTMLElement.prototype.scrollIntoView = vi.fn();

// Test data
const MOCK_TORONTO = CANADIAN_CITIES[0]; // Toronto
const MOCK_VANCOUVER = CANADIAN_CITIES[1]; // Vancouver

describe('LocationSearch', () => {
    const onLocationSelect = vi.fn();
    const onSetPrimary = vi.fn();

    beforeEach(() => {
        vi.clearAllMocks();
        // Default to Desktop view for easier Dialog testing
        (useMediaQuery as any).mockReturnValue(true);
        // Default to "Never set primary" for fresh state
        (hasEverSetPrimary as any).mockReturnValue(false);
    });

    const openSearch = () => {
        const trigger = screen.getByRole('combobox', { name: /select a location/i });
        fireEvent.click(trigger);
    };

    it('renders correctly and opens location list', () => {
        render(
            <LocationSearch
                currentLocation={MOCK_TORONTO}
                onLocationSelect={onLocationSelect}
            />
        );

        // Check trigger button shows current location name
        expect(screen.getByText(MOCK_TORONTO.name)).toBeTruthy();

        // Open the dialog
        openSearch();

        // Should see Popular Cities header (since logic falls back to popular if no favorites/search)
        expect(screen.getByText('Popular Cities')).toBeTruthy();
        // Should see Toronto in the list (Trigger + List item)
        expect(screen.getAllByText('Toronto').length).toBeGreaterThan(0);
    });

    it('displays Primary badge for the primary location', () => {
        render(
            <LocationSearch
                currentLocation={MOCK_TORONTO}
                primaryLocation={MOCK_TORONTO}
                onLocationSelect={onLocationSelect}
                onSetPrimary={onSetPrimary}
            />
        );

        openSearch();

        // "Primary" badge text should be visible next to Toronto
        // We look for "Primary" within the dialog
        const badges = screen.getAllByText('Primary');
        expect(badges.length).toBeGreaterThan(0);
    });

    it('does NOT show "Set Primary" button for the location that is already primary', () => {
        render(
            <LocationSearch
                currentLocation={MOCK_TORONTO}
                primaryLocation={MOCK_TORONTO}
                onLocationSelect={onLocationSelect}
                onSetPrimary={onSetPrimary}
            />
        );

        openSearch();

        // The "Set Primary" button is rendered conditionally: {!isPrimary && onSetPrimary}
        // So for Toronto (Primary), it should NOT be present.
        // However, for other cities (Montreal, Vancouver), it SHOULD be present.

        const setPrimaryButtons = screen.getAllByRole('button', { name: /set .* as primary location/i });

        // We expect some buttons for NON-primary cities
        expect(setPrimaryButtons.length).toBeGreaterThan(0);

        // We explicitly check that Toronto does NOT have one
        const torontoButton = screen.queryByRole('button', { name: /set toronto as primary location/i });
        expect(torontoButton).toBeNull();
    });

    describe('Primary Location Confirmation Flow', () => {
        it('FIRST TIME: Sets primary immediately + shows toast (no dialog)', () => {
            // Mock: User has never set primary
            (hasEverSetPrimary as any).mockReturnValue(false);

            render(
                <LocationSearch
                    currentLocation={MOCK_TORONTO}
                    primaryLocation={null}
                    onLocationSelect={onLocationSelect}
                    onSetPrimary={onSetPrimary}
                />
            );

            openSearch();

            // Find "Set Primary" for Vancouver
            const setVancouverBtn = screen.getByRole('button', { name: /set vancouver as primary location/i });
            fireEvent.click(setVancouverBtn);

            // Expect immediate calls
            expect(onSetPrimary).toHaveBeenCalledWith(MOCK_VANCOUVER);
            expect(markPrimaryAsSet).toHaveBeenCalled();
            expect(toast.success).toHaveBeenCalledWith(
                expect.stringContaining('Vancouver is now your Primary Location'),
                expect.any(Object)
            );

            // Verify NO confirmation dialog appeared (checking for dialog title)
            expect(screen.queryByText('Change Primary Location?')).toBeNull();
        });

        it('SUBSEQUENT TIME: Shows confirmation dialog before setting', async () => {
            // Mock: User HAS set primary before
            (hasEverSetPrimary as any).mockReturnValue(true);

            render(
                <LocationSearch
                    currentLocation={MOCK_TORONTO}
                    primaryLocation={MOCK_TORONTO}
                    onLocationSelect={onLocationSelect}
                    onSetPrimary={onSetPrimary}
                />
            );

            openSearch();

            // Click "Set Primary" for Vancouver
            const setVancouverBtn = screen.getByRole('button', { name: /set vancouver as primary location/i });
            fireEvent.click(setVancouverBtn);

            // Expect NO immediate call
            expect(onSetPrimary).not.toHaveBeenCalled();
            expect(markPrimaryAsSet).not.toHaveBeenCalled();

            // Verify Dialog IS showing
            expect(screen.getByText('Change Primary Location?')).toBeTruthy();
            expect(screen.getByText(/stop collecting observations for/i)).toBeTruthy();
            expect(screen.getByText(/start collecting them for/i)).toBeTruthy();

            // Click Confirm
            const confirmBtn = screen.getByRole('button', { name: 'Change Primary' });
            fireEvent.click(confirmBtn);

            // NOW expect the call
            expect(onSetPrimary).toHaveBeenCalledWith(MOCK_VANCOUVER);
            expect(toast.success).toHaveBeenCalled();
        });

        it('SUBSEQUENT TIME: Can cancel the confirmation dialog', async () => {
            // Mock: User HAS set primary before
            (hasEverSetPrimary as any).mockReturnValue(true);

            render(
                <LocationSearch
                    currentLocation={MOCK_TORONTO}
                    primaryLocation={MOCK_TORONTO}
                    onLocationSelect={onLocationSelect}
                    onSetPrimary={onSetPrimary}
                />
            );

            openSearch();

            // Click "Set Primary" for Vancouver
            const setVancouverBtn = screen.getByRole('button', { name: /set vancouver as primary location/i });
            fireEvent.click(setVancouverBtn);

            // Verify Dialog is open
            expect(screen.getByText('Change Primary Location?')).toBeTruthy();

            // Click Cancel ("Keep Toronto")
            const cancelBtn = screen.getByRole('button', { name: /keep toronto/i });
            fireEvent.click(cancelBtn);

            // Wait for dialog to close (optional check, usually just check logic)
            await waitFor(() => {
                expect(screen.queryByText('Change Primary Location?')).toBeNull();
            });

            // Verify onSetPrimary was NEVER called
            expect(onSetPrimary).not.toHaveBeenCalled();
        });
    });
});
