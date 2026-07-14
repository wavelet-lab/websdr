<script lang="ts">
export interface DropdownOptionProps<T = any> {
    value: T;                 // value associated with this option
    label?: string;           // optional, display label for this option
    disabled?: boolean;       // optional, whether this option is disabled
    selected?: boolean;       // optional, whether this option is selected
    active?: boolean;         // optional, whether this option is the active keyboard item
    optionIndex?: number;     // optional, index in the rendered options list
    icon?: string;            // optional, icon for this option
    description?: string;     // optional, description for this option
}
</script>

<script setup lang="ts">
import { computed } from 'vue';

interface Emits {
    (e: 'select', value: any): void;
}

const props = withDefaults(defineProps<DropdownOptionProps>(), {
    disabled: false,
    selected: false,
    active: false,
    optionIndex: undefined
});
const emit = defineEmits<Emits>();

const displayLabel = computed(() => props.label || String(props.value));

const onClick = () => {
    if (!props.disabled) emit('select', props.value);
}
</script>

<template>
    <div class="dropdown-option" role="option" :aria-selected="selected" :aria-disabled="disabled"
        :data-option-index="optionIndex" :tabindex="active && !disabled ? 0 : -1" :class="{
        'dropdown-option--selected': selected,
        'dropdown-option--active': active,
        'dropdown-option--disabled': disabled
    }" @click.stop="onClick" @keydown.enter.prevent.stop="onClick" @keydown.space.prevent.stop="onClick">
        <div class="dropdown-option-check">
            <slot v-if="selected" name="check-icon">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" />
                </svg>
            </slot>
        </div>

        <!-- Icon -->
        <div v-if="icon || $slots.icon" class="dropdown-option-icon">
            <slot name="icon">
                <i :class="icon"></i>
            </slot>
        </div>

        <!-- Content -->
        <div class="dropdown-option-content">
            <div class="dropdown-option-label">
                <slot name="label">{{ displayLabel }}</slot>
            </div>
            <div v-if="description || $slots.description" class="dropdown-option-description">
                <slot name="description">{{ description }}</slot>
            </div>
        </div>
    </div>
</template>

<style scoped src="@/styles/dropdown-option.scss" />
