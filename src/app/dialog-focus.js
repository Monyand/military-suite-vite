export function bindDialogFocusTrap(dialogRef, onClose) {
    const last = document.activeElement;
    dialogRef.current?.querySelector('input, select, textarea, button')?.focus();
    const keydown = event => {
        if (event.key === 'Escape') onClose();
        if (event.key === 'Tab' && dialogRef.current) {
            const items = [...dialogRef.current.querySelectorAll('button, input, select, textarea')].filter(el => !el.disabled && el.offsetParent !== null);
            const first = items[0], lastItem = items[items.length - 1];
            if (event.shiftKey && document.activeElement === first) { event.preventDefault(); lastItem?.focus(); }
            else if (!event.shiftKey && document.activeElement === lastItem) { event.preventDefault(); first?.focus(); }
        }
    };
    document.addEventListener('keydown', keydown);
    return () => { document.removeEventListener('keydown', keydown); if (last?.isConnected) last.focus(); };
}

