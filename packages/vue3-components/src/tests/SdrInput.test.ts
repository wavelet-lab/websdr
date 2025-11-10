import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick, defineComponent } from 'vue'
import SdrInput from '@/components/SdrInput.vue'

// Mock webusb module
vi.mock('@websdr/frontend-core/webusb', () => {
    return {
        getWebUsbManagerInstance: vi.fn(),
        WebUsbManagerMode: { SINGLE: 'single', WORKER: 'worker' }
    }
})
import { getWebUsbManagerInstance, WebUsbManagerMode } from '@websdr/frontend-core/webusb'

describe('SdrInput.vue', () => {
    const DropdownStub = defineComponent({
        name: 'Dropdown',
        props: ['status', 'size', 'placeholder', 'disabled', 'maxHeight', 'noPanel'],
        template: `<div><span class="dd-status">{{ status }}</span><slot name="display"></slot></div>`
    })

    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('renders placeholder when no device provided', async () => {
        const wrapper = mount(SdrInput, {
            props: { device: { devName: '', vendorId: 0, productId: 0 } }, // provide empty device to satisfy required prop
            global: { stubs: { Dropdown: DropdownStub } }
        })
        await nextTick()
        expect(wrapper.text()).toContain('Click to select SDR')
        const statusEl = wrapper.find('.dd-status')
        expect(statusEl.exists()).toBe(true)
        expect(statusEl.text()).toBe('error')
    })

    it('shows device name and status=success when device prop provided', async () => {
        const device = { devName: 'SDR-One', vendorId: 123, productId: 456 }
        const wrapper = mount(SdrInput, {
            props: { device },
            global: { stubs: { Dropdown: DropdownStub } }
        })
        await nextTick()
        expect(wrapper.text()).toContain('SDR-One')
        const statusEl = wrapper.find('.dd-status')
        expect(statusEl.exists()).toBe(true)
        expect(statusEl.text()).toBe('success')
    })

    it('calls WebUsb manager and emits update::device on open', async () => {
        const device = { devName: 'USB-Device', vendorId: 1, productId: 2 }
        const mockManager = { requestDevice: vi.fn().mockResolvedValue(device) }
            ; (getWebUsbManagerInstance as any).mockReturnValue(mockManager)

        const wrapper = mount(SdrInput, {
            props: { device: { devName: '', vendorId: 0, productId: 0 } }, // satisfy required prop
            global: { stubs: { Dropdown: DropdownStub } }
        })

        const dropdown = wrapper.findComponent(DropdownStub)
        // simulate open event -> component should call requestUsb -> selectUsb -> emit update::device
        await dropdown.vm.$emit('open')
        // wait for promise resolution and next ticks
        await nextTick()
        await nextTick()

        // ensure getWebUsbManagerInstance was called with SINGLE mode
        expect((getWebUsbManagerInstance as any).mock.calls.length).toBeGreaterThan(0)
        expect((getWebUsbManagerInstance as any).mock.calls[0][0]).toBe(WebUsbManagerMode.SINGLE)

        const emitted = wrapper.emitted()['update::device']
        expect(emitted).toBeTruthy()
        expect((emitted![0] as any)[0]).toBeDefined()
        expect((emitted![0] as any)[0].devName).toBe('USB-Device')
    })
})