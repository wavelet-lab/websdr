<script lang="ts">
import { defineComponent } from 'vue';
import type { RequestDeviceInfo } from '@websdr/frontend-core/webusb';

export type { RequestDeviceInfo };

export default defineComponent({
    name: 'SdrInput',
});

export interface SdrInputProps {
    device: RequestDeviceInfo; // Currently selected SDR device
    mode?: 'single' | 'worker'; // Mode of WebUsb manager operation
    placeholder?: string; // Placeholder text for the input
    size?: DropdownProps['size']; // Size of the input
    disabled?: boolean; // Whether the input is disabled
}

</script>

<script setup lang="ts">
import { computed, reactive, watch } from 'vue';
import Dropdown, { type DropdownProps } from './Dropdown.vue';
import { getWebUsbManagerInstance, WebUsbManagerMode } from '@websdr/frontend-core/webusb';

interface Emits {
    (e: 'update::device', requestDevice: RequestDeviceInfo): void;
}

const props = withDefaults(defineProps<SdrInputProps>(), {
    mode: 'single',
    placeholder: 'Click to select SDR',
    disabled: false,
    size: 'medium',
});

const emit = defineEmits<Emits>();

const mode = props.mode !== undefined && props.mode.toLowerCase() === 'single' ? WebUsbManagerMode.SINGLE : WebUsbManagerMode.WORKER;

const value = reactive<RequestDeviceInfo>(props.device ?? { devName: '', vendorId: 0, productId: 0 });

watch(() => props.device, (newValue) => {
    Object.assign(value, newValue);
}, { deep: true });

async function selectUsb(requestDevice: RequestDeviceInfo | undefined) {
    // console.log('selectUsb', mode, requestDevice)
    if (requestDevice !== undefined) {
        Object.assign(value, requestDevice);
        // console.log('setstorage', device)
        emit('update::device', value);
    } else {
        value.devName = '';
        value.vendorId = 0;
        value.productId = 0;
        emit('update::device', value);
    }
}

async function requestUsb() {
    // console.log('requestUsb', mode, event);
    const webUsbManager = getWebUsbManagerInstance(mode);
    const requestDevice = await webUsbManager.requestDevice()
    // console.log('REQ DEV', requestDevice);
    if (requestDevice) {
        selectUsb(requestDevice);
    }
}

const displayText = computed(() => {
    return value.devName || props.placeholder || '';
});

const dropdownStatus = computed((): DropdownProps['status'] => {
    if (!value.devName) return 'error';
    else return 'success';
});

</script>

<template>
    <Dropdown :size="props.size" :status="dropdownStatus" :placeholder="props.placeholder" :disabled="props.disabled"
        max-height="none" @open="requestUsb" no-panel>
        <template #display>
            <div class="sdr-input-text">
                {{ displayText }}
            </div>
        </template>
    </Dropdown>
</template>

<style scoped src="@/styles/sdr-input.scss" />
