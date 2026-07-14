<script lang="ts">
import { defineComponent } from 'vue';

export default defineComponent({
    name: 'LogAreaItem',
});
</script>

<script setup lang="ts">
import { computed } from 'vue'
import { JournalLogLevel } from '@websdr/core/utils'
import type { JournalLogItem } from '@websdr/core/utils'
import { timestampToTimeString } from '@websdr/core/utils'

const props = defineProps<{
    modelValue: JournalLogItem;
}>();

const JournalLogLevelToClassMap: Record<JournalLogLevel, string> = {
    [JournalLogLevel.FATAL]: 'fatal',
    [JournalLogLevel.ERROR]: 'error',
    [JournalLogLevel.WARNING]: 'warning',
    [JournalLogLevel.INFO]: 'info',
    [JournalLogLevel.DEBUG]: 'debug',
};

const logclass = computed((): string => {
    return JournalLogLevelToClassMap[props.modelValue.logLevel] ?? 'debug';
});

const formattedTime = computed(() => timestampToTimeString(props.modelValue.timestamp))
const levelText = computed(() => props.modelValue.logLevel ?? JournalLogLevel.DEBUG)

</script>


<template>
    <div class="log-area-item">
        <p :class="logclass">
            <span class="log-area-item__time">{{ formattedTime }}</span>
            <span class="log-area-item__level">[{{ levelText }}]</span>
            <b class="log-area-item__subsystem">{{ props.modelValue.subSystem }}:</b>
            <span class="log-area-item__message">{{ props.modelValue.message }}</span>
        </p>
    </div>
</template>

<style lang="scss" src="@/styles/log-area.scss" />
