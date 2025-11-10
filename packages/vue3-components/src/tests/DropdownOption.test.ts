import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import DropdownOption from '@/components/DropdownOption.vue'
import { nextTick } from 'vue'

describe('DropdownOption.vue', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('renders displayLabel from label prop or value', async () => {
        const w1 = mount(DropdownOption, { props: { value: 'v1', label: 'Label 1' } })
        expect(w1.text()).toContain('Label 1')

        const w2 = mount(DropdownOption, { props: { value: 123 } })
        expect(w2.text()).toContain('123')
    })

    it('emits select with value when clicked and not disabled', async () => {
        const wrapper = mount(DropdownOption, { props: { value: 'val' } })
        await wrapper.find('.dropdown-option').trigger('click')
        expect(wrapper.emitted()).toHaveProperty('select')
        expect((wrapper.emitted()!['select'] as any)[0]).toEqual(['val'])
    })

    it('does not emit select when disabled', async () => {
        const wrapper = mount(DropdownOption, { props: { value: 'val', disabled: true } })
        await wrapper.find('.dropdown-option').trigger('click')
        expect(wrapper.emitted()['select']).toBeUndefined()
    })

    it('applies selected/disabled classes', () => {
        const wrapper = mount(DropdownOption, { props: { value: 'x', selected: true, disabled: true } })
        const root = wrapper.find('.dropdown-option')
        expect(root.classes()).toContain('dropdown-option--selected')
        expect(root.classes()).toContain('dropdown-option--disabled')
    })

    it('renders icon, label and description slots', async () => {
        const wrapper = mount(DropdownOption, {
            props: { value: 'xx' },
            slots: {
                icon: '<i class="slot-icon">I</i>',
                label: '<span class="slot-label">Slot Label</span>',
                description: '<span class="slot-desc">Slot Desc</span>'
            }
        })
        await nextTick()
        expect(wrapper.find('.slot-icon').exists()).toBe(true)
        expect(wrapper.find('.slot-label').exists()).toBe(true)
        expect(wrapper.find('.slot-desc').exists()).toBe(true)
    })

    it('renders check icon slot when selected', async () => {
        const wrapper = mount(DropdownOption, {
            props: { value: 'x', selected: true },
            slots: { 'check-icon': '<span class="check-slot">OK</span>' }
        })
        await nextTick()
        expect(wrapper.find('.check-slot').exists()).toBe(true)
    })
})