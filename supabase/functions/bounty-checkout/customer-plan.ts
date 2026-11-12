// Which Stripe customer a website post's Checkout uses: the reads behind
// planCheckoutCustomer (logic.ts). Separate from index.ts so Jest and the
// staging test script run this exact code.
//
// Every read fails toward the plan that touches no one's customer: an
// unreadable account lookup gets no save offer and no customer, an unreadable
// matched customer counts as unsafe (a guest payment). A signed-in caller's
// profile read is the exception: it throws, before anything is stored, rather
// than quietly making that poster a second customer.

import {
  customerSafeForUnverifiedCaller,
  planCheckoutCustomer,
  type CheckoutCustomerPlan,
} from './logic.ts'

// deno-lint-ignore no-explicit-any
type AnyClient = any

export async function resolveCustomerPlan(args: {
  stripe: AnyClient
  admin: AnyClient
  authedUserId: string | null
  email: string
  withTimeout?: <T>(q: PromiseLike<T>) => Promise<T>
}): Promise<CheckoutCustomerPlan> {
  const { stripe, admin, authedUserId, email } = args
  const timed = args.withTimeout ?? (<T>(q: PromiseLike<T>) => Promise.resolve(q))

  const profileCustomerOf = async (userId: string): Promise<string | null> => {
    const { data: profile, error } = (await timed(
      admin.from('profiles').select('stripe_customer_id').eq('id', userId).maybeSingle()
    )) as { data: { stripe_customer_id?: string | null } | null; error: unknown }
    if (error) throw error
    return profile?.stripe_customer_id ?? null
  }

  if (authedUserId) {
    return planCheckoutCustomer({
      signedIn: true,
      profileCustomerId: await profileCustomerOf(authedUserId),
      emailMatchesAccount: true,
      customerSafeForStranger: false,
    })
  }

  let matchedUserId: string | null = null
  let profileCustomerId: string | null = null
  try {
    const { data: found, error } = (await timed(
      admin.rpc('fn_find_user_id_by_email', { p_email: email })
    )) as { data: string | null; error: unknown }
    if (error) throw error
    matchedUserId = found ?? null
    if (matchedUserId) profileCustomerId = await profileCustomerOf(matchedUserId)
  } catch (err) {
    console.warn('[bounty-checkout] Could not look up the account for this email; not offering save', {
      message: (err as { message?: string })?.message,
    })
    return { customerId: null, ownCustomer: false, createCustomer: false, offerSave: false }
  }

  let safe = false
  if (matchedUserId && profileCustomerId) {
    try {
      const customer = await stripe.customers.retrieve(profileCustomerId)
      const shown = await stripe.customers.listPaymentMethods(profileCustomerId, {
        allow_redisplay: 'always',
        limit: 1,
      })
      safe = customerSafeForUnverifiedCaller(
        customer,
        Array.isArray(shown?.data) ? shown.data.length : null
      )
    } catch (err) {
      console.warn('[bounty-checkout] Could not check the matched customer; using a guest payment', {
        message: (err as { message?: string })?.message,
      })
      safe = false
    }
  }

  return planCheckoutCustomer({
    signedIn: false,
    profileCustomerId,
    emailMatchesAccount: !!matchedUserId,
    customerSafeForStranger: safe,
  })
}
