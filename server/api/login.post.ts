import { z } from 'zod'

const _invalidCredentialsError = createError({
  statusCode: 401,
  message: 'Invalid credentials',
})

export default eventHandler(async (event) => {
  const config = useRuntimeConfig()

  if (config.public.oauth.github?.enabled || config.public.oauth.pocketid?.enabled) {
    throw createError({
      statusCode: 403,
      statusMessage: 'Forbidden',
      message: 'Password login is disabled',
    })
  }

  const db = useDB()
  const { email, password } = await readValidatedBody(
    event,
    z.object({
      email: z.email(),
      password: z.string().min(6),
    }).parse,
  )

  const user = db
    .select()
    .from(tables.users)
    .where(eq(tables.users.email, email))
    .get()

  if (!user) {
    throw _invalidCredentialsError
  }

  if (!(await verifyPassword(user.password || '', password))) {
    throw _invalidCredentialsError
  }

  await setUserSession(
    event,
    { user },
    {
      cookie: {
        // secure: !useRuntimeConfig().allowInsecureCookie,
        secure: false,
      },
    },
  )

  return setResponseStatus(event, 201)
})
