<script lang="ts">
import { defineComponent } from 'vue';
import type { SizeType, VariantType, StatusType, PlacementType } from './components.d';
import type { DropdownOptionProps } from './DropdownOption.vue';

export type { SizeType, VariantType, StatusType, PlacementType, DropdownOptionProps };

export default defineComponent({
    name: 'Dropdown',
});

export interface DropdownProps<T = any> {
    modelValue?: T | Array<T>;      // current selected value(s) 
    placeholder?: string;           // placeholder text when no selection
    disabled?: boolean;             // disable interaction
    loading?: boolean;              // show loading state
    clearable?: boolean;            // show clear button when selection is made
    searchable?: boolean;           // allow searching/filtering options
    multiple?: boolean;             // allow multiple selection
    noPanel?: boolean;              // do not show options panel after click
    size?: SizeType;                // size of the component
    variant?: VariantType;          // visual style variant
    status?: StatusType;            // status indicator
    maxHeight?: string;             // maximum height of the dropdown panel
    minWidth?: string;              // minimum width of the dropdown panel
    placement?: PlacementType;      // preferred placement
    options?: Array<DropdownOptionProps<T>>;    // optional array of options
    totalCount?: number;             // optional total count when using getItem
    getItem?: (index: number) => DropdownOptionProps<T>;  // optional getter for on-demand access
}
</script>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, nextTick, watch } from 'vue';
import type { CSSProperties } from 'vue';
import DropdownOption from './DropdownOption.vue';
import List from './List.vue';
import { calculateDisplayItems } from '@/utils/textMeasure';

interface Emits {
    (e: 'update:modelValue', value: any): void;
    (e: 'change', value: any): void;
    (e: 'open'): void;
    (e: 'close'): void;
    (e: 'search', query: string): void;
    (e: 'clear'): void;
}

const props = withDefaults(defineProps<DropdownProps>(), {
    placeholder: 'Select option',
    disabled: false,
    loading: false,
    clearable: false,
    searchable: false,
    multiple: false,
    noPanel: false,
    size: 'medium',
    variant: 'default',
    status: 'default',
    maxHeight: '300px',
    minWidth: undefined,
    placement: 'auto',
    options: () => []
});

const emit = defineEmits<Emits>();

const isOpen = ref(false);
const searchQuery = ref('');
const triggerRef = ref<HTMLDivElement>();
const dropdownRef = ref<HTMLDivElement>();
const searchInputRef = ref<HTMLInputElement>();
const textRef = ref<HTMLDivElement>();
const activeOptionIndex = ref<number>(0);
const restoreFocusOnClose = ref(true);

// Render/animation state for closing animation
const isRendered = ref(false); // controls v-if rendering of the panel
const isClosing = ref(false);  // adds .dropdown-panel--closing class

const selectedValues = computed({
    get: () => props.multiple
        ? (Array.isArray(props.modelValue) ? props.modelValue : [])
        : props.modelValue,
    set: (value) => {
        emit('update:modelValue', value);
        emit('change', value);
    }
});

const getOptionLabel = (value: any): string => {
    if (value == null) return '';

    const option = props.options.find(opt => opt.value === value);

    // If option found and has a valid label, use it
    if (option && typeof option.label === 'string' && option.label.trim() !== '') {
        return option.label;
    }

    // Otherwise use the value itself
    if (typeof value === 'object') {
        // For objects, try to find a reasonable string representation
        if (value.toString && value.toString !== '[object Object]') {
            return value.toString();
        }
        // If it's a plain object, try to extract some meaningful value
        if (value.name) return String(value.name);
        if (value.title) return String(value.title);
        if (value.label) return String(value.label);
        // Fallback to JSON representation for objects
        return JSON.stringify(value);
    }

    return String(value);
};

// Sort selected values by their order in the original options array
const sortedSelectedValues = computed(() => {
    if (!props.multiple) return selectedValues.value;

    const values = selectedValues.value as any[];
    if (!values || values.length === 0) return [];

    // Create a map for quick lookup of option indices
    const optionIndexMap = new Map();
    props.options.forEach((option, index) => {
        optionIndexMap.set(option.value, index);
    });

    // Sort selected values by their index in the options array
    return [...values].sort((a, b) => {
        const indexA = optionIndexMap.get(a);
        const indexB = optionIndexMap.get(b);

        // If option not found in options array, put it at the end
        if (indexA === undefined && indexB === undefined) return 0;
        if (indexA === undefined) return 1;
        if (indexB === undefined) return -1;

        return indexA - indexB;
    });
});

// Recompute panel geometry (position/width) on demand
const geometryKey = ref(0);
const requestGeometryRecalc = () => { geometryKey.value++; };

const fontForSize = (size: 'small' | 'medium' | 'large') =>
    `${size === 'small' ? '14px' : size === 'large' ? '18px' : '16px'} -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;

const displayText = computed(() => {
    if (props.loading) return 'Loading...';

    if (props.multiple) {
        const values = sortedSelectedValues.value as any[];
        if (!values || values.length === 0) return props.placeholder;

        // Force dependency on geometryKey to reflow on size change
        geometryKey.value;

        let availableWidth = 200;
        if (textRef.value) {
            const containerWidth = textRef.value.offsetWidth;
            availableWidth = Math.max(100, containerWidth - 20);
        }

        const { displayItems, remainingCount } = calculateDisplayItems({
            values,
            availableWidth,
            labelFor: (v: any) => getOptionLabel(v),
            font: fontForSize(props.size),
            separator: ', ',
            suffix: (n: number) => `+${n} more`,
            minItems: 1
        });

        const labels = displayItems.map(v => getOptionLabel(v));
        return remainingCount > 0
            ? `${labels.join(', ')}, +${remainingCount} more`
            : labels.join(', ');
    }

    if (selectedValues.value == null) return props.placeholder;
    return getOptionLabel(selectedValues.value);
});

const statusClass = computed(() => `dropdown-status--${props.status}`);
const sizeClass = computed(() => `dropdown-size--${props.size}`);
const variantClass = computed(() => `dropdown-variant--${props.variant}`);

const canClear = computed(() => {
    return props.clearable && !props.disabled && selectedValues.value != null &&
        (!props.multiple || (Array.isArray(selectedValues.value) && selectedValues.value.length > 0));
});

// Add placement state
const actualPlacement = ref<'bottom' | 'top'>('bottom');

// Calculate optimal placement based on available space
const calculatePlacement = (): 'bottom' | 'top' => {
    if (props.placement !== 'auto') {
        return props.placement;
    }

    if (!triggerRef.value || !dropdownRef.value) {
        return 'bottom';
    }

    const triggerRect = triggerRef.value.getBoundingClientRect();
    const dropdownHeight = dropdownRef.value.offsetHeight || 300;
    const viewportHeight = window.innerHeight;

    const spaceBelow = viewportHeight - triggerRect.bottom;
    const spaceAbove = triggerRect.top;

    return spaceBelow >= dropdownHeight || spaceBelow > spaceAbove ? 'bottom' : 'top';
};

// Update placement when dropdown opens
const updatePlacement = async () => {
    if (!isOpen.value) return;

    await nextTick(); // Wait for DOM update
    actualPlacement.value = calculatePlacement();
    // Also request geometry recompute (left/top/width)
    requestGeometryRecalc();
};

// Open/close with animation-aware flow
const enabledOptionIndices = computed<number[]>(() => {
    return filteredOptions.value
        .map((option, index) => option.disabled ? -1 : index)
        .filter(index => index >= 0);
});

const hasGeneratedOptions = computed(() => filteredOptions.value.length > 0);

const clampActiveOptionIndex = (index: number) => {
    const indices = enabledOptionIndices.value;
    if (indices.length === 0) return 0;
    const firstIndex = indices[0] ?? 0;
    const lastIndex = indices[indices.length - 1] ?? firstIndex;
    if (index <= firstIndex) return firstIndex;
    if (index >= lastIndex) return lastIndex;

    return indices.reduce((closest, current) =>
        Math.abs(current - index) < Math.abs(closest - index) ? current : closest
    , firstIndex);
};

const getInitialActiveOptionIndex = () => {
    if (!hasGeneratedOptions.value) return 0;
    const selectedIndex = filteredOptions.value.findIndex(option => props.multiple
        ? (selectedValues.value as any[])?.includes(option.value)
        : selectedValues.value === option.value
    );

    return clampActiveOptionIndex(selectedIndex >= 0 ? selectedIndex : 0);
};

const focusOptionByIndex = async (index: number) => {
    activeOptionIndex.value = clampActiveOptionIndex(index);
    await nextTick();

    let option = dropdownRef.value?.querySelector<HTMLElement>(
        `.dropdown-option[data-option-index="${activeOptionIndex.value}"]`
    );

    if (option) {
        option.focus();
        option.scrollIntoView({ block: 'nearest' });
        return;
    }

    const list = dropdownRef.value?.querySelector<HTMLElement>('.list');
    if (list && filteredOptions.value.length > 0) {
        const renderedOption = list.querySelector<HTMLElement>('.dropdown-option');
        const estimatedRowHeight = renderedOption?.getBoundingClientRect().height
            || list.scrollHeight / Math.max(1, filteredOptions.value.length)
            || 40;
        const targetTop = activeOptionIndex.value * estimatedRowHeight;
        const centeredTop = targetTop - Math.max(0, (list.clientHeight - estimatedRowHeight) / 2);
        list.scrollTop = Math.max(0, Math.min(centeredTop, list.scrollHeight - list.clientHeight));

        await nextTick();
        option = dropdownRef.value?.querySelector<HTMLElement>(
            `.dropdown-option[data-option-index="${activeOptionIndex.value}"]`
        );

        if (!option) {
            await new Promise(resolve => requestAnimationFrame(resolve));
            option = dropdownRef.value?.querySelector<HTMLElement>(
                `.dropdown-option[data-option-index="${activeOptionIndex.value}"]`
            );
        }

        option?.focus();
    }
};

const focusFirstPanelElement = async () => {
    await nextTick();
    if (hasGeneratedOptions.value) {
        activeOptionIndex.value = getInitialActiveOptionIndex();
        if (props.searchable) {
            searchInputRef.value?.focus();
        } else {
            await focusOptionByIndex(activeOptionIndex.value);
        }
        return;
    }

    const focusable = dropdownRef.value?.querySelector<HTMLElement>(
        'input:not([disabled]), button:not([disabled]), [tabindex]:not([tabindex="-1"]), .dropdown-option:not(.dropdown-option--disabled)'
    );
    focusable?.focus();
};

const openDropdown = async () => {
    if (props.disabled || isOpen.value) return;

    if (props.noPanel) {
        emit('open');
        return;
    }

    isClosing.value = false;   // reset closing flag
    isRendered.value = true;   // mount panel for animation
    isOpen.value = true;

    emit('open');
    await updatePlacement();
    requestGeometryRecalc();

    await focusFirstPanelElement();
};

// Finalize close after animation
const finalizeClose = () => {
    isClosing.value = false;
    isRendered.value = false; // unmount panel
    emit('close');
    searchQuery.value = '';
    if (restoreFocusOnClose.value) {
        triggerRef.value?.focus();
    }
    restoreFocusOnClose.value = true;
};

const closeDropdown = (restoreFocus = true) => {
    if (!isOpen.value && !isRendered.value) return;

    restoreFocusOnClose.value = restoreFocus;
    isOpen.value = false;

    const el = dropdownRef.value;
    if (!el) {
        finalizeClose();
        return;
    }

    isClosing.value = true;

    // Wait a frame so the closing class is applied
    requestAnimationFrame(() => {
        const style = getComputedStyle(el);
        const names = (style.animationName || '')
            .split(',')
            .map(s => s.trim())
            .filter(Boolean);

        // Only wait if the mobile closing animation is present on the panel
        const hasMobileClosing = names.includes('backdrop-fade-out');

        if (!hasMobileClosing) {
            finalizeClose(); // desktop: close immediately
            return;
        }

        let finished = false;
        const finish = () => {
            if (finished) return;
            finished = true;
            el.removeEventListener('animationend', onEnd as any);
            el.removeEventListener('animationcancel', onEnd as any);
            finalizeClose();
        };

        const onEnd = (e: AnimationEvent) => {
            if (e.target !== el) return; // wait for panel backdrop animation
            finish();
        };

        el.addEventListener('animationend', onEnd as any);
        el.addEventListener('animationcancel', onEnd as any);

        // Safety timeout in case the event is missed
        setTimeout(finish, 500);
    });
};

// Toggle respects animated close
const toggleDropdown = async () => {
    if (props.disabled) return;
    if (isOpen.value) {
        closeDropdown();
    } else {
        await openDropdown();
    }
};

// Add placement class computed
const placementClass = computed(() => `dropdown-panel--${actualPlacement.value}`);

// Robust inside check that works with Teleport and touch events
const isEventInside = (el: Element | undefined, event: Event) => {
    if (!el) return false;
    const path = (event.composedPath?.() ?? []) as EventTarget[];
    if (path.length) return path.includes(el);
    const target = event.target as Node | null;
    return !!(target && el.contains(target));
};

const onDocumentClick = (event: MouseEvent) => {
    if (!isOpen.value) return;
    const clickedOutside =
        !isEventInside(triggerRef.value, event) &&
        !isEventInside(dropdownRef.value, event);
    if (clickedOutside) closeDropdown();
};

const onDocumentKeydown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') closeDropdown();
};

const onClearSelection = (event: Event) => {
    event.stopPropagation();
    selectedValues.value = props.multiple ? [] : null;
    emit('clear');
};

const onOptionSelect = (value: any) => {
    if (props.multiple) {
        const currentValues = (selectedValues.value as any[]) || [];
        selectedValues.value = currentValues.includes(value)
            ? currentValues.filter(v => v !== value)
            : [...currentValues, value];
    } else {
        selectedValues.value = value;
        closeDropdown();
    }
};

const getDocumentTabbableElements = () => {
    const selector = [
        'a[href]',
        'button:not([disabled])',
        'input:not([disabled])',
        'select:not([disabled])',
        'textarea:not([disabled])',
        '[tabindex]:not([tabindex="-1"])',
    ].join(',');

    return Array.from(document.querySelectorAll<HTMLElement>(selector))
        .filter(element => {
            if (dropdownRef.value?.contains(element)) return false;
            if (element.getAttribute('aria-disabled') === 'true') return false;
            if (element.closest('[hidden], [aria-hidden="true"]')) return false;
            return true;
        });
};

const focusAdjacentExternalElement = (backwards: boolean) => {
    const tabbable = getDocumentTabbableElements();
    const container = triggerRef.value?.closest('.dropdown-container') ?? triggerRef.value;
    if (container) {
        const target = backwards
            ? [...tabbable].reverse().find(element =>
                !container.contains(element) &&
                Boolean(container.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_PRECEDING)
            )
            : tabbable.find(element =>
                !container.contains(element) &&
                Boolean(container.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING)
            );

        if (target) {
            target.focus();
            return;
        }
    }

    const currentIndex = triggerRef.value ? tabbable.indexOf(triggerRef.value) : -1;
    const nextIndex = currentIndex + (backwards ? -1 : 1);
    const target = tabbable[nextIndex];

    target?.focus();
};

const getPanelFocusableElements = () => {
    if (!dropdownRef.value) return [];

    const selector = [
        'a[href]',
        'button:not([disabled])',
        'input:not([disabled])',
        'select:not([disabled])',
        'textarea:not([disabled])',
        '[tabindex]:not([tabindex="-1"])',
    ].join(',');

    return Array.from(dropdownRef.value.querySelectorAll<HTMLElement>(selector))
        .filter(element => {
            if (element.getAttribute('aria-disabled') === 'true') return false;
            if (element.closest('[hidden], [aria-hidden="true"]')) return false;
            return true;
        });
};

const closeAndFocusAdjacentExternalElement = (backwards: boolean) => {
    focusAdjacentExternalElement(backwards);
    isOpen.value = false;
    isClosing.value = false;
    isRendered.value = false;
    emit('close');
    searchQuery.value = '';
};

const moveActiveOption = async (delta: number) => {
    const indices = enabledOptionIndices.value;
    if (indices.length === 0) return;

    const currentPosition = Math.max(0, indices.indexOf(activeOptionIndex.value));
    const nextPosition = Math.min(indices.length - 1, Math.max(0, currentPosition + delta));
    await focusOptionByIndex(indices[nextPosition] ?? indices[0] ?? 0);
};

const onGeneratedOptionsKeydown = async (event: KeyboardEvent) => {
    if (!hasGeneratedOptions.value) return;

    const activeElement = document.activeElement as HTMLElement | null;
    const isSearchInputActive = activeElement === searchInputRef.value;
    const isGeneratedOptionActive = Boolean(activeElement?.closest('.dropdown-option'));

    switch (event.key) {
        case 'ArrowDown':
            event.preventDefault();
            await moveActiveOption(1);
            break;
        case 'ArrowUp':
            event.preventDefault();
            await moveActiveOption(-1);
            break;
        case 'PageDown':
            event.preventDefault();
            await moveActiveOption(10);
            break;
        case 'PageUp':
            event.preventDefault();
            await moveActiveOption(-10);
            break;
        case 'Home':
            event.preventDefault();
            await focusOptionByIndex(enabledOptionIndices.value[0] ?? 0);
            break;
        case 'End':
            event.preventDefault();
            await focusOptionByIndex(enabledOptionIndices.value[enabledOptionIndices.value.length - 1] ?? 0);
            break;
        case 'Enter':
        case ' ':
            event.preventDefault();
            {
                const activeOption = filteredOptions.value[activeOptionIndex.value];
                if (activeOption && !activeOption.disabled) {
                    onOptionSelect(activeOption.value);
                }
            }
            break;
        case 'Tab':
            event.preventDefault();
            if (props.searchable && isGeneratedOptionActive && !isSearchInputActive) {
                searchInputRef.value?.focus();
                break;
            }

            closeAndFocusAdjacentExternalElement(event.shiftKey);
            break;
    }
};

const onCustomContentKeydown = (event: KeyboardEvent) => {
    if (hasGeneratedOptions.value || event.key !== 'Tab') return;

    const focusableElements = getPanelFocusableElements();
    if (focusableElements.length === 0) {
        event.preventDefault();
        closeAndFocusAdjacentExternalElement(event.shiftKey);
        return;
    }

    const firstElement = focusableElements[0];
    const lastElement = focusableElements[focusableElements.length - 1];
    const activeElement = document.activeElement;
    const isLeavingBackward = event.shiftKey && activeElement === firstElement;
    const isLeavingForward = !event.shiftKey && activeElement === lastElement;

    if (isLeavingBackward || isLeavingForward) {
        event.preventDefault();
        closeAndFocusAdjacentExternalElement(event.shiftKey);
    }
};

// Listen for scroll and resize events to update placement
const onWindowScroll = () => {
    if (!isOpen.value) return;
    updatePlacement();
    requestGeometryRecalc();
};

const onWindowResize = () => {
    if (!isOpen.value) return;
    updatePlacement();
    requestGeometryRecalc();
};

const onSearchInput = (event: Event) => {
    const target = event.target as HTMLInputElement;
    searchQuery.value = target.value;
    emit('search', searchQuery.value);
};

const clearSearchQuery = async () => {
    searchQuery.value = '';
    await nextTick();
    searchInputRef.value?.focus();
};

// Recalculate display text when component is resized
const resizeObserver = ref<ResizeObserver | null>(null);

// Filter options based on search query
const filteredOptions = computed(() => {
    if (!props.searchable || !searchQuery.value.trim()) {
        return props.options;
    }

    const query = searchQuery.value.toLowerCase().trim();
    const ret = props.options.filter(option => {
        // Search in label if available, otherwise in value
        const searchText = option.label ? option.label.toLowerCase() : String(option.value).toLowerCase();
        return searchText.includes(query);
    });

    return ret;
});

watch(() => searchQuery.value, (newQuery) => {
    emit('search', newQuery);
});

watch(filteredOptions, () => {
    activeOptionIndex.value = getInitialActiveOptionIndex();
});

const scrollListenerOptions: AddEventListenerOptions = { capture: true, passive: true };

onMounted(() => {
    document.addEventListener('click', onDocumentClick);
    document.addEventListener('keydown', onDocumentKeydown);
    window.addEventListener('scroll', onWindowScroll, scrollListenerOptions);
    window.addEventListener('resize', onWindowResize);
    window.addEventListener('orientationchange', onWindowResize);

    // Set up resize observer
    if (triggerRef.value && 'ResizeObserver' in window) {
        resizeObserver.value = new ResizeObserver(() => {
            updatePlacement();
            requestGeometryRecalc();
        });
        resizeObserver.value.observe(triggerRef.value);
    }
});

onUnmounted(() => {
    document.removeEventListener('click', onDocumentClick);
    document.removeEventListener('keydown', onDocumentKeydown);
    window.removeEventListener('scroll', onWindowScroll, scrollListenerOptions);
    window.removeEventListener('resize', onWindowResize);
    window.removeEventListener('orientationchange', onWindowResize);

    if (resizeObserver.value) {
        resizeObserver.value.disconnect();
    }
});

const panelStyle = computed<CSSProperties>(() => {
    // Force recompute when geometryKey changes
    geometryKey.value;

    if (!triggerRef.value) return {};
    const rect = triggerRef.value.getBoundingClientRect();
    return {
        position: 'fixed',
        left: `${rect.left}px`,
        top: actualPlacement.value === 'bottom'
            ? `${rect.bottom}px`
            : `${rect.top - (dropdownRef.value?.offsetHeight ?? 300)}px`,
        width: `${rect.width - 2}px`,
        minWidth: props.minWidth,
        zIndex: 9999,
    };
});
</script>

<template>
    <div class="dropdown-container" :style="{ minWidth }">
        <!-- Trigger button -->
        <div ref="triggerRef" class="dropdown-trigger" :class="[
            sizeClass,
            variantClass,
            statusClass,
            {
                'dropdown-trigger--open': isOpen,
                'dropdown-trigger--disabled': disabled,
                'dropdown-trigger--loading': loading
            }
        ]" role="button" aria-haspopup="dialog" :aria-expanded="isOpen" :aria-disabled="disabled"
            :tabindex="disabled ? -1 : 0" @click.stop="toggleDropdown" @keydown.enter.prevent="toggleDropdown"
            @keydown.space.prevent="toggleDropdown">
            <div class="dropdown-content">
                <!-- Prefix slot -->
                <div v-if="$slots.prefix" class="dropdown-prefix">
                    <slot name="prefix" />
                </div>

                <!-- Status indicator -->
                <div v-if="status !== 'default'" class="status-indicator">
                    <span class="status-dot"></span>
                </div>

                <!-- Display text -->
                <div ref="textRef"
                    :class="['dropdown-text', { 'placeholder': !selectedValues || (Array.isArray(selectedValues) && selectedValues.length === 0) }]">
                    <slot name="display" :value="selectedValues" :text="displayText"
                        :sorted-values="sortedSelectedValues">
                        {{ displayText }}
                    </slot>
                </div>

                <!-- Clear button -->
                <button v-if="canClear" type="button" class="dropdown-clear" @click="onClearSelection" @keydown.stop>
                    <slot name="clear-icon">
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
                            <path
                                d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
                        </svg>
                    </slot>
                </button>

                <!-- Arrow icon -->
                <div v-if="!loading" class="dropdown-arrow">
                    <slot name="arrow" :open="isOpen">
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"
                            :class="{ 'arrow-up': isOpen }">
                            <path d="M7 10l5 5 5-5z" />
                        </svg>
                    </slot>
                </div>

                <!-- Suffix slot -->
                <div v-if="$slots.suffix" class="dropdown-suffix">
                    <slot name="suffix" />
                </div>
            </div>
        </div>

        <!-- Dropdown panel via Teleport -->
        <Teleport to="body" v-if="isRendered">
            <div ref="dropdownRef" class="dropdown-panel" role="dialog"
                :class="[placementClass, { 'dropdown-panel--closing': isClosing }]" :style="panelStyle"
                @click.stop="() => closeDropdown()" @keydown="onGeneratedOptionsKeydown"
                @keydown.capture="onCustomContentKeydown"
                @keydown.esc.stop.prevent="() => closeDropdown()">
                <div class="dropdown-panel__content" @click.stop>

                    <!-- Search input -->
                    <div v-if="searchable" class="dropdown-search">
                        <div class="dropdown-search-control">
                            <input ref="searchInputRef" v-model="searchQuery" type="text" class="dropdown-search-input"
                                placeholder="Search..." @input="onSearchInput" />
                            <button v-if="searchQuery" type="button" class="dropdown-search-clear"
                                aria-label="Clear search" @click.stop="clearSearchQuery" @keydown.stop>
                                <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                                    <path
                                        d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
                                </svg>
                            </button>
                        </div>
                    </div>

                    <!-- Header slot -->
                    <div v-if="$slots.header" class="dropdown-header">
                        <slot name="header" />
                    </div>

                    <!-- Options/content -->
                    <div class="dropdown-content-wrapper" :style="{ maxHeight }">
                        <template v-if="props.options && props.options.length > 0">
                            <List v-if="filteredOptions && filteredOptions.length > 0" :items="filteredOptions"
                                :totalCount="props.totalCount" :getItem="props.getItem" :itemHeight="0"
                                :virtualBuffer="5" :maxHeight="maxHeight">
                                <template #default="{ item, index }">
                                    <DropdownOption :key="item.value" :value="item.value" :label="item.label"
                                        :option-index="index" :active="activeOptionIndex === index"
                                        :description="item.description" :icon="item.icon" :disabled="item.disabled"
                                        :selected="multiple
                                            ? (selectedValues as any[])?.includes(item.value)
                                            : selectedValues === item.value" @select="onOptionSelect" />
                                </template>
                            </List>
                            <!-- Empty state for search -->
                            <div v-else class="dropdown-empty">
                                <slot name="no-results">No results found for "{{ searchQuery }}"</slot>
                            </div>
                        </template>
                        <template v-else>
                            <!-- Empty state for no options -->
                            <slot name="content" :close="closeDropdown" :search-query="searchQuery"
                                :selected-values="selectedValues"
                                :update-selection="(value: any) => selectedValues = value">
                                <!-- Default empty state -->
                                <div class="dropdown-empty">
                                    <slot name="empty">No options available</slot>
                                </div>
                            </slot>
                        </template>
                    </div>

                    <!-- Footer slot -->
                    <div v-if="$slots.footer" class="dropdown-footer">
                        <slot name="footer" :close="closeDropdown" />
                    </div>
                </div>
            </div>
        </Teleport>
    </div>
</template>

<style scoped src="@/styles/dropdown.scss" />
