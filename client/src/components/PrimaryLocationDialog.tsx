/**
 * PrimaryLocationDialog - Confirmation dialog for changing Primary Location
 * 
 * Shows a lightweight AlertDialog explaining the consequence of changing
 * Primary Location (stopping observations for old, starting for new).
 */

import React from 'react';
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import type { Location } from '@/lib/weatherApi';

interface PrimaryLocationDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    currentPrimary: Location;
    newLocation: Location;
    onConfirm: () => void;
}

export function PrimaryLocationDialog({
    open,
    onOpenChange,
    currentPrimary,
    newLocation,
    onConfirm,
}: PrimaryLocationDialogProps) {
    const handleConfirm = () => {
        onConfirm();
        onOpenChange(false);
    };

    return (
        <AlertDialog open={open} onOpenChange={onOpenChange}>
            <AlertDialogContent className="glass-card border-white/10">
                <AlertDialogHeader>
                    <AlertDialogTitle>Change Primary Location?</AlertDialogTitle>
                    <AlertDialogDescription className="text-foreground/70">
                        Changing your Primary Location will stop collecting observations for{' '}
                        <span className="font-medium text-foreground">{currentPrimary.name}</span>{' '}
                        and start collecting them for{' '}
                        <span className="font-medium text-foreground">{newLocation.name}</span>.
                    </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                    <AlertDialogCancel className="border-white/10">
                        Keep {currentPrimary.name}
                    </AlertDialogCancel>
                    <AlertDialogAction onClick={handleConfirm}>
                        Change Primary
                    </AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    );
}
