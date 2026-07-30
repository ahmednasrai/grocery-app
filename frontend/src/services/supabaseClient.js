import { createClient } from '@supabase/supabase-js'

const supabaseUrl = 'https://pvcvfzslwxapryagsdzc.supabase.co'
const supabaseAnonKey = 'sb_publishable_iV7jz3ZI8QlmBvYD8urDGw_ib70WvDN'

export const supabase = createClient(supabaseUrl, supabaseAnonKey)






