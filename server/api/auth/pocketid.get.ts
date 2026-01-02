const _accessDeniedError = createError({
    statusCode: 403,
    statusMessage:
        'Access denied. Please contact the administrator to activate your account.',
})

export default defineEventHandler(async (event) => {
    const config = useRuntimeConfig(event)
    // @ts-ignore
    const pocketIdConfig = config.public.oauth.pocketid
    // @ts-ignore
    const { clientId, clientSecret } = config.oauth.pocketid

    if (!pocketIdConfig?.url || !clientId || !clientSecret) {
        throw createError({
            statusCode: 500,
            statusMessage: 'PocketID configuration missing (URL, Client ID, or Client Secret)',
        })
    }

    const baseUrl = pocketIdConfig.url.replace(/\/$/, '')
    const authorizationURL = `${baseUrl}/authorize`
    const tokenURL = `${baseUrl}/api/oidc/token`
    const userURL = `${baseUrl}/api/oidc/userinfo`

    // Use a fixed redirect URI based on the current request
    // Assumes the application is served at root. If a subpath is used, need to adapt.
    // Using getRequestURL to dynamically determine host/protocol
    const requestUrl = getRequestURL(event)
    const redirectUri = `${requestUrl.protocol}//${requestUrl.host}/api/auth/pocketid`

    const { code, state, error } = getQuery(event) as { code?: string, state?: string, error?: string }

    if (error) {
        logger.chrono.error('PocketID OAuth error:', error)
        throw createError({
            statusCode: 401,
            statusMessage: `Authentication failed: ${error}`,
        })
    }

    if (!code) {
        // Redirect to authorization
        const state = crypto.randomUUID()
        setCookie(event, 'pocketid_state', state, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            maxAge: 60 * 10, // 10 minutes
            sameSite: 'lax'
        })

        const params = new URLSearchParams({
            client_id: clientId,
            redirect_uri: redirectUri,
            response_type: 'code',
            scope: 'openid profile email',
            state,
        })

        return sendRedirect(event, `${authorizationURL}?${params.toString()}`)
    }

    // Verify state
    const storedState = getCookie(event, 'pocketid_state')
    if (!state || !storedState || state !== storedState) {
        throw createError({
            statusCode: 400,
            statusMessage: 'Invalid state',
        })
    }
    deleteCookie(event, 'pocketid_state')

    // Exchange code for token
    const tokens: any = await $fetch(tokenURL, {
        method: 'POST',
        body: new URLSearchParams({
            grant_type: 'authorization_code',
            code,
            client_id: clientId,
            client_secret: clientSecret,
            redirect_uri: redirectUri,
        }),
    }).catch((err) => {
        logger.chrono.error('Failed to exchange code for token', err)
        throw createError({
            statusCode: 500,
            statusMessage: 'Failed to authenticate with PocketID',
        })
    })

    if (!tokens || !tokens.access_token) {
        throw createError({
            statusCode: 500,
            statusMessage: 'No access token received',
        })
    }

    // Get User Info
    const user: any = await $fetch(userURL, {
        headers: {
            Authorization: `Bearer ${tokens.access_token}`,
        },
    }).catch((err) => {
        logger.chrono.error('Failed to fetch user info', err)
        throw createError({
            statusCode: 500,
            statusMessage: 'Failed to fetch user info',
        })
    })

    // --- Logic from github.get.ts adapted ---
    const db = useDB()
    const userFromEmail = db
        .select()
        .from(tables.users)
        .where(eq(tables.users.email, user.email || ''))
        .get()

    logger.chrono.info(
        'PocketID OAuth login:',
        user.email,
        userFromEmail ? 'Existing user' : 'New user',
    )

    if (!userFromEmail) {
        // create a new user without admin permission
        db.insert(tables.users)
            .values({
                username: user.name || user.preferred_username || user.email?.split('@')[0] || 'User',
                email: user.email || '',
                avatar: null, // PocketID might not provide avatar or use Gravatar
                createdAt: new Date(),
            })
            .returning()
            .get()
        // then reject login
        throw _accessDeniedError
    } else if (userFromEmail.isAdmin === 0) {
        throw _accessDeniedError
    } else {
        await setUserSession(
            event,
            { user: userFromEmail },
            {
                cookie: {
                    secure: !useRuntimeConfig().allowInsecureCookie && process.env.NODE_ENV === 'production',
                },
            },
        )
    }

    return sendRedirect(event, '/')
})
