import { ApiError } from '../lib/apiError';

const MESSAGES: Partial<Record<string, string>> = {
  CONFLICT: 'Otra persona hizo cambios mientras editabas. Revisa los datos actualizados e inténtalo de nuevo.',
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
  POSSIBLE_DUPLICATE: 'Parece un gasto ya registrado.',
  CATEGORY_INACTIVE: 'La categoría ya no está disponible. Elige otra.',
  DUPLICATE_CATEGORY: 'Ya existe una categoría con ese nombre.',
  PREVIEW_REQUIRED: 'Revisa el impacto en los saldos antes de confirmar.',
  REFUND_EXCEEDS: 'La devolución supera lo reembolsable.',
  REFUND_CONSTRAINT: 'No puedes dejar un ítem por debajo de lo ya devuelto.',
  AI_CONSENT_REQUIRED: 'Debes aceptar el aviso de privacidad para escanear.',
  AI_QUOTA_EXCEEDED: 'Cuota de escaneo agotada; puedes registrar el gasto a mano.',
  AI_UNAVAILABLE: 'El escaneo no está disponible ahora; puedes registrar el gasto a mano.',
  ATTACHMENT_INVALID: 'Archivo no permitido: revisa el tipo, el tamaño o las páginas.',
  ATTACHMENT_DUPLICATE: 'Ese archivo ya está adjunto.',
  NOT_RECONCILED: 'Los importes no cuadran con el total.',
  INVALID_PERCENT: 'Los porcentajes deben sumar exactamente 100,00 %.',
  ITEM_WITHOUT_BENEFICIARY: 'Hay ítems sin beneficiario.',
  ACCOUNT_DELETION_BLOCKED: 'Tienes pagos pendientes de confirmar. Resuélvelos antes de borrar la cuenta.',
  ACCOUNT_DELETED: 'Esta cuenta fue eliminada.',
  REAUTH_REQUIRED: 'Por seguridad, vuelve a iniciar sesión para continuar.',
  SERVICE_UNAVAILABLE:
    'El servicio no está disponible temporalmente. Lo que estabas haciendo no se ha perdido; inténtalo más tarde.',
};

export function errorText(error: unknown): string {
  if (error instanceof ApiError && error.code === 'RATE_LIMITED') {
    const wait = Number(error.details?.['retryAfter'] ?? 60);
    return `Demasiadas solicitudes seguidas. Espera ${wait} s e inténtalo de nuevo.`;
  }
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
