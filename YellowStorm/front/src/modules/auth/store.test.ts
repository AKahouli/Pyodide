import { beforeEach, describe, expect, it } from 'vitest';
import { useAuthModalStore } from './store';

describe('auth modal store', () => {
  beforeEach(() => {
    useAuthModalStore.setState({
      activeModal: null,
      registerSuccess: false,
      registeredEmail: '',
      inviteToken: null,
      inviteEmail: null,
    });
  });

  it('starts with the default state', () => {
    const state = useAuthModalStore.getState();
    expect(state.activeModal).toBeNull();
    expect(state.registerSuccess).toBe(false);
    expect(state.registeredEmail).toBe('');
    expect(state.inviteToken).toBeNull();
    expect(state.inviteEmail).toBeNull();
  });

  it('updates modal state through actions', () => {
    const state = useAuthModalStore.getState();

    state.setActiveModal('login');
    state.setRegisterSuccess(true);
    state.setRegisteredEmail('user@example.com');
    state.setInvite('tok-1', 'invited@example.com');

    const updated = useAuthModalStore.getState();
    expect(updated.activeModal).toBe('login');
    expect(updated.registerSuccess).toBe(true);
    expect(updated.registeredEmail).toBe('user@example.com');
    expect(updated.inviteToken).toBe('tok-1');
    expect(updated.inviteEmail).toBe('invited@example.com');
  });

  it('resets all modal fields', () => {
    useAuthModalStore.setState({
      activeModal: 'register',
      registerSuccess: true,
      registeredEmail: 'reset-me@example.com',
      inviteToken: 'tok-1',
      inviteEmail: 'invited@example.com',
    });

    useAuthModalStore.getState().resetModalState();

    const state = useAuthModalStore.getState();
    expect(state.activeModal).toBeNull();
    expect(state.registerSuccess).toBe(false);
    expect(state.registeredEmail).toBe('');
    expect(state.inviteToken).toBeNull();
    expect(state.inviteEmail).toBeNull();
  });
});
