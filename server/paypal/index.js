import { modes } from '../config.js'
import { createMockPaypal } from './mock.js'
import { createLivePaypal } from './live.js'

let instance = null

// One PayPal client per process: the mock world when no sandbox credentials are set.
export function getPaypal() {
  if (!instance) instance = modes.paypal === 'sandbox' ? createLivePaypal() : createMockPaypal()
  return instance
}

export function setPaypalForTests(client) {
  instance = client
}

export const paypalMode = () => modes.paypal
