<script lang="ts" setup>
import type { ButtonProps } from '@nuxt/ui'

useHead({
  title: $t('auth.form.signin.title'),
})

const { fetch: fetchUserSession } = useUserSession()
const config = useRuntimeConfig()
const toast = useToast()
const route = useRoute()
const router = useRouter()

const isLoading = ref(false)

const onAuthSubmit = async (event: any) => {
  isLoading.value = true
  await $fetch('/api/login', {
    method: 'POST',
    body: event.data,
  })
    .then(async () => {
      await fetchUserSession()
      router.push(route.query.redirect?.toString() || '/')
    })
    .catch((error) => {
      console.error('Login error:', error)
      toast.add({
        color: 'error',
        title: 'Login Failed',
        description:
          error?.data?.message ||
          'An unexpected error occurred. Please try again.',
      })
    })
    .finally(() => {
      isLoading.value = false
    })
}
const providers = computed(() => {
  const list: (ButtonProps | boolean)[] = [
    config.public.oauth.github.enabled && {
      icon: 'tabler:brand-github',
      size: 'lg',
      color: 'neutral',
      variant: 'subtle',
      block: true,
      label: 'GitHub',
      to: '/api/auth/github',
      external: true,
    },
    // @ts-ignore
    config.public.oauth.pocketid?.enabled && {
      icon: 'tabler:id',
      size: 'lg',
      color: 'neutral',
      variant: 'subtle',
      block: true,
      label: 'PocketID',
      to: '/api/auth/pocketid',
      external: true,
    },
  ]
  return list.filter((p): p is ButtonProps => !!p)
})
</script>

<template>
  <div
    class="w-full min-h-svh flex flex-col items-center justify-center p-4 pb-12"
  >
    <AuthForm
      :title="$t('auth.form.signin.title')"
      :subtitle="$t('auth.form.signin.subtitle', [config.public.app.title])"
      :loading="isLoading"
      :providers="providers"
      :disable-password="providers.length > 0"
      @submit="onAuthSubmit"
    />
  </div>
</template>

<style scoped></style>
