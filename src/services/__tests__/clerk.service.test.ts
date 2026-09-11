import { clerkClient } from '@clerk/express';
import { inviteSeller } from '../clerk.service';

jest.mock('@clerk/express', () => ({
  clerkClient: {
    invitations: { createInvitation: jest.fn() },
  },
}));

const createInvitationMock = clerkClient.invitations.createInvitation as jest.Mock;

describe('inviteSeller', () => {
  it('crea la invitación con el correo del vendedor', async () => {
    createInvitationMock.mockResolvedValue({});

    await inviteSeller('vendedor@pragma.test');

    expect(createInvitationMock).toHaveBeenCalledWith({
      emailAddress: 'vendedor@pragma.test',
    });
  });

  it('traduce form_identifier_exists a un CustomError 409', async () => {
    createInvitationMock.mockRejectedValue({
      errors: [{ code: 'form_identifier_exists' }],
    });

    await expect(inviteSeller('repetido@pragma.test')).rejects.toMatchObject({
      statusCode: 409,
    });
  });

  it('propaga cualquier otro error de Clerk sin traducirlo', async () => {
    const otherError = new Error('Clerk caído');
    createInvitationMock.mockRejectedValue(otherError);

    await expect(inviteSeller('vendedor@pragma.test')).rejects.toBe(otherError);
  });
});
