// Event-type resolution for Even Hub envelopes.
//
// CLICK_EVENT is 0, and protobuf omits zero-value fields on the wire, so a
// single tap arrives as an envelope whose `eventType` is `undefined`. The
// default has to be resolved INSIDE the envelope check. Writing
// `event.sysEvent?.eventType ?? OsEventTypeList.CLICK_EVENT` instead would
// read CLICK on events that carry no `sysEvent` at all, so every scroll,
// exit and audio frame would fire the tap handler.

import { OsEventTypeList as Events } from '@evenrealities/even_hub_sdk'
import type { OsEventTypeList } from '@evenrealities/even_hub_sdk'

export function eventTypeOf(envelope?: {
  eventType?: OsEventTypeList
}): OsEventTypeList | null {
  if (!envelope) return null
  return envelope.eventType ?? Events.CLICK_EVENT
}
