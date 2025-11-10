import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import LogAreaItem from '@/components/LogAreaItem.vue'

// Mocking external module to control JournalLogLevel and time formatting
vi.mock('@websdr/core/utils', () => {
    return {
        JournalLogLevel: {
            FATAL: 0,
            ERROR: 1,
            WARNING: 2,
            INFO: 3,
            DEBUG: 4
        },
        timestampToTimeString: vi.fn(() => '12:34:56')
    }
})
import { JournalLogLevel, timestampToTimeString } from '@websdr/core/utils'

describe('LogAreaItem.vue', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('renders time, subsystem and message and applies class for INFO', () => {
        const item = {
            timestamp: 123456,
            subSystem: 'TestSys',
            logLevel: JournalLogLevel.INFO,
            message: 'Test message'
        }
        const wrapper = mount(LogAreaItem, { props: { modelValue: item } })
        const p = wrapper.find('p')
        expect(wrapper.text()).toContain('12:34:56')
        expect(wrapper.text()).toContain('TestSys:')
        expect(wrapper.text()).toContain('Test message')
        expect(p.classes()).toContain('info')
        expect((timestampToTimeString as any)).toHaveBeenCalledWith(123456)
    })

    it('maps other levels to appropriate classes and falls back to debug', () => {
        const cases: Array<[string, string]> = [
            [JournalLogLevel.FATAL, 'fatal'],
            [JournalLogLevel.ERROR, 'error'],
            [JournalLogLevel.WARNING, 'warning'],
            [JournalLogLevel.DEBUG, 'debug'],
            ['999', 'debug'] // unknown -> fallback
        ]
        for (const [lvl, expectedClass] of cases) {
            const item: any = { timestamp: 1, subSystem: 'S', logLevel: lvl, message: 'm' }
            const wrapper = mount(LogAreaItem, { props: { modelValue: item } })
            const p = wrapper.find('p')
            expect(p.classes()).toContain(expectedClass)
            wrapper.unmount()
        }
    })
})