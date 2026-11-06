import { z } from 'zod';
import { defineAction } from './dispatch';
import { savePushSettings } from '../phone-push';
export const pushActions={
 'push.saveSettings':defineAction({ownerOnly:true,input:z.object({channels:z.object({app:z.boolean(),telegram:z.boolean()})}),run:({channels})=>savePushSettings(channels)})
};
