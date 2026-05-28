<script lang="ts">
import { defineComponent } from 'vue';
import type { RequestDeviceInfo } from '@websdr/frontend-core/webusb';
import type { SizeType } from './components.d';

export type { RequestDeviceInfo, SizeType };

export default defineComponent({
    name: 'SdrInput',
});

export interface SdrInputProps {
    device?: RequestDeviceInfo; // Currently selected SDR device
    mode?: 'single' | 'worker'; // Mode of WebUsb manager operation
    placeholder?: string; // Placeholder text for the input
    unsupportedMessage?: string; // Message shown when WebUSB is not available
    size?: SizeType; // Size of the input
    disabled?: boolean; // Whether the input is disabled
}

</script>

<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import Dropdown from './Dropdown.vue';
import { getWebUsbManagerInstance, WebUsbManagerMode } from '@websdr/frontend-core/webusb';
import type { StatusType } from './components.d';

interface Emits {
    (e: 'update:device', requestDevice: RequestDeviceInfo): void;
}

const props = withDefaults(defineProps<SdrInputProps>(), {
    mode: 'single',
    placeholder: 'Click to select SDR',
    unsupportedMessage: '❗ WebUSB is not supported in this browser',
    disabled: false,
    size: 'medium',
});

const emit = defineEmits<Emits>();

const mode = props.mode !== undefined && props.mode.toLowerCase() === 'single' ? WebUsbManagerMode.SINGLE : WebUsbManagerMode.WORKER;

const value = reactive<RequestDeviceInfo>(props.device ?? { devName: '', vendorId: 0, productId: 0 });
const isWebUsbAvailable = ref(isWebUsbSupported());
const errorMessage = ref(isWebUsbAvailable.value ? '' : props.unsupportedMessage);

watch(() => props.device, (newValue) => {
    Object.assign(value, newValue);
}, { deep: true });

async function selectUsb(requestDevice: RequestDeviceInfo | undefined) {
    errorMessage.value = '';
    // console.log('selectUsb', mode, requestDevice)
    if (requestDevice !== undefined) {
        Object.assign(value, requestDevice);
        // console.log('setstorage', device)
        emit('update:device', value);
    } else {
        value.devName = '';
        value.vendorId = 0;
        value.productId = 0;
        emit('update:device', value);
    }
}

function isWebUsbSupported() {
    const usb = typeof navigator !== 'undefined'
        ? (navigator as Navigator & { usb?: { requestDevice?: unknown } }).usb
        : undefined;

    return typeof navigator !== 'undefined'
        && typeof usb?.requestDevice === 'function';
}

async function requestUsb() {
    // console.log('requestUsb', mode, event);
    isWebUsbAvailable.value = isWebUsbSupported();
    if (!isWebUsbAvailable.value) {
        errorMessage.value = props.unsupportedMessage;
        return;
    }

    errorMessage.value = '';
    const webUsbManager = getWebUsbManagerInstance(mode);
    const requestDevice = await webUsbManager.requestDevice()
    // console.log('REQ DEV', requestDevice);
    if (requestDevice) {
        selectUsb(requestDevice);
    }
}

const displayText = computed(() => {
    if (errorMessage.value) return errorMessage.value;
    return value.devName || props.placeholder || '';
});

const dropdownStatus = computed((): StatusType => {
    if (value.devName) return 'success';
    if (errorMessage.value) return 'error';
    return 'error';
});

</script>

<template>
    <Dropdown :size="props.size" :status="dropdownStatus" :placeholder="props.placeholder" :disabled="props.disabled"
        max-height="none" @open="requestUsb" no-panel>
        <template #display>
            <div class="sdr-input-text" :title="displayText">
                {{ displayText }}
            </div>
        </template>
    </Dropdown>
</template>

<style scoped src="@/styles/sdr-input.scss" />
