import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { CURRENCY_CODES, Currency, Email, IsoDate, type Trip } from 'contracts';
import { useForm } from 'react-hook-form';
import { useNavigate } from 'react-router';
import { z } from 'zod';
import { ErrorMessage } from '../../components/ErrorMessage';
import { Field, inputClass } from '../../components/Field';
import { api } from '../../lib/apiClient';

const FormSchema = z
  .object({
    name: z.string().trim().min(1, 'Escribe un nombre').max(80),
    startDate: IsoDate,
    endDate: IsoDate,
    currency: Currency,
    invites: z.string(),
  })
  .refine((v) => v.endDate >= v.startDate, { path: ['endDate'], message: 'La fecha de fin es anterior al inicio' })
  .transform((v, ctx) => {
    const raw = v.invites.split(/[\s,;]+/).filter(Boolean);
    const emails: string[] = [];
    for (const r of raw) {
      const parsed = Email.safeParse(r);
      if (!parsed.success) {
        ctx.addIssue({ code: 'custom', path: ['invites'], message: `Correo inválido: ${r}` });
        return z.NEVER;
      }
      emails.push(parsed.data);
    }
    return { name: v.name, startDate: v.startDate, endDate: v.endDate, currency: v.currency, inviteEmails: emails };
  });

type FormInput = z.input<typeof FormSchema>;
type FormOutput = z.output<typeof FormSchema>;

const COMMON = ['USD', 'EUR', 'BOB', 'ARS', 'CLP', 'MXN', 'PEN', 'COP', 'BRL'];

export function CreateTripPage() {
  const navigate = useNavigate();
  const form = useForm<FormInput, unknown, FormOutput>({
    resolver: zodResolver(FormSchema),
    defaultValues: { name: '', startDate: '', endDate: '', currency: 'USD', invites: '' },
  });
  const mutation = useMutation({
    mutationFn: (body: FormOutput) => api<{ trip: Trip }>('POST', '/trips', { body }),
    onSuccess: ({ trip }) => navigate(`/trips/${trip.id}`),
  });
  const { errors } = form.formState;
  const others = CURRENCY_CODES.filter((c) => !COMMON.includes(c));

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Nuevo viaje</h1>
      <form noValidate onSubmit={form.handleSubmit((v) => mutation.mutate(v))} className="space-y-4">
        <Field id="name" label="Nombre del viaje" error={errors.name?.message}>
          <input id="name" className={inputClass} aria-invalid={!!errors.name} {...form.register('name')} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field id="startDate" label="Fecha de inicio" error={errors.startDate?.message && 'Fecha inválida'}>
            <input id="startDate" type="date" className={inputClass} aria-invalid={!!errors.startDate} {...form.register('startDate')} />
          </Field>
          <Field id="endDate" label="Fecha de fin" error={errors.endDate?.message}>
            <input id="endDate" type="date" className={inputClass} aria-invalid={!!errors.endDate} {...form.register('endDate')} />
          </Field>
        </div>
        <Field id="currency" label="Moneda" hint="Única para todo el viaje. Queda fija al registrar el primer gasto.">
          <select id="currency" className={inputClass} aria-describedby="currency-hint" {...form.register('currency')}>
            <optgroup label="Frecuentes">
              {COMMON.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </optgroup>
            <optgroup label="Todas (ISO 4217)">
              {others.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </optgroup>
          </select>
        </Field>
        <Field
          id="invites"
          label="Invitar por correo"
          error={errors.invites?.message}
          hint="Correos de Google separados por comas. El viaje se activa cuando todos aceptan."
        >
          <textarea id="invites" rows={3} className={inputClass} aria-invalid={!!errors.invites} {...form.register('invites')} />
        </Field>
        <ErrorMessage error={mutation.error} />
        <button
          type="submit"
          disabled={mutation.isPending}
          className="w-full rounded-xl bg-brand-700 px-4 py-3 font-semibold text-white disabled:opacity-60"
        >
          {mutation.isPending ? 'Creando…' : 'Crear viaje'}
        </button>
      </form>
    </div>
  );
}
