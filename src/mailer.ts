import {z} from 'zod';
import {error, json} from "./router";
import {Env} from "./cloudDrive";

const mcContactSchema = z.object({
    email: z.string().email(),
    name: z.string().optional(),
});

const mcContentSchema = z.object({
    type: z.string(),
    value: z.string(),
});

const mcPersonalizationSchema = z.object({
    to: z.array(mcContactSchema),
});

const mcEmailSchema = z.object({
    personalizations: z.array(mcPersonalizationSchema),
    from: mcContactSchema,
    reply_to: mcContactSchema.optional(),
    cc: z.array(mcContactSchema).optional(),
    bcc: z.array(mcContactSchema).optional(),
    subject: z.string(),
    content: z.array(mcContentSchema),
});

const requestBodySchema = z.object({
    email: mcEmailSchema,
});

type IMCEmail = z.infer<typeof mcEmailSchema>;

type EmailRequest = Request & {
    email: IMCEmail,
}

export async function authenticate (request: Request, env: Env) {
    const auth = request.headers.get('authorization');

    if (!auth) {
        return error(401, 'Unauthorized');
    }

    if (env.EMAIL_TOKEN === '') {
        return error(500, 'Missing email token');
    }

    if (auth !== `Bearer ${env.EMAIL_TOKEN}`) {
        return error(401, 'Unauthorized');
    }
}

export async function retrieveEmailFromBody (request: EmailRequest) {
    const contentType = request.headers.get('content-type') ?? '';

    if (!contentType.includes('application/json')) {
        return error(400, 'Invalid content type');
    }

    const body = await request.json();
    const email = requestBodySchema.safeParse(body);

    if (!email.success) {
        return error(400, 'Invalid request body');
    }

    request.email = email.data.email;
}

export async function sendEmail (request: EmailRequest) {
    const resp = await fetch(
        new Request('https://api.mailchannels.net/tx/v1/send', {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
            },
            body: JSON.stringify(request.email),
        })
    );

    if (!resp.ok) {
        return error(500, 'Failed to send email');
    }

    return json({success: true});
}
