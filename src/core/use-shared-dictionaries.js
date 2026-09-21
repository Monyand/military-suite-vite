import { useEffect, useReducer } from 'react';
import { SharedDictionaries } from './dictionary-service.js';

export function useSharedDictionaries() {
    const [, update] = useReducer(value => value + 1, 0);
    useEffect(() => {
        window.addEventListener('suite-dictionaries-changed', update);
        return () => window.removeEventListener('suite-dictionaries-changed', update);
    }, []);
    return SharedDictionaries.options;
}

export function useOvtTemplates() {
    useSharedDictionaries();
    return SharedDictionaries.ovtTemplates();
}
