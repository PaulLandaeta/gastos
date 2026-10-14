import { ApiError } from '../lib/apiClient';

const MESSAGES: Partial<Record<string, string>> = {
  CONFLICT: 'Otra persona modificó el viaje. Revisa los datos actualizados e inténtalo de nuevo.',
  DUPLICATE_INVITATION: 'Ese correo ya está invitado o ya participa en el viaje.',
  MEMBER_ALREADY_ACCEPTED: 'No se puede retirar a un participante que ya aceptó.',
  PARTICIPANTS_LOCKED: 'Los participantes quedaron fijos al registrar el primer gasto.',
  CURRENCY_LOCKED: 'La moneda quedó fija al registrar el primer gasto.',
  TRIP_READ_ONLY: 'El viaje está en solo lectura.',
  TRIP_NOT_READY: 'Todos los invitados deben aceptar antes de registrar gastos.',
  EMAIL_NOT_VERIFIED: 'Tu correo de Google no está verificado.',
  FORBIDDEN: 'Tu rol no permite esta acción.',
  NOT_FOUND: 'No encontrado o sin acceso.',
  VALIDATION_FAILED: 'Revisa los datos del formulario.',
  NETWORK: 'Sin conexión con el servidor.',
};

export function errorText(error: unknown): string {
  if (error instanceof ApiError) return MESSAGES[error.code] ?? error.message;
  return 'Ocurrió un error inesperado.';
}

export function ErrorMessage({ error }: { error: unknown }) {
  if (!error) return null;
  return (
    <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
      {errorText(error)}
    </p>
  );
}
