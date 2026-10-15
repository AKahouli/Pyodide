import * as React from 'react';
import { render, screen } from '@testing-library/react';
import { useForm } from 'react-hook-form';
import { describe, expect, it } from 'vitest';

import { Form, FormField, FormItem, FormSuccessMessage } from './form';

type Values = { password: string };

function Harness({ invalid }: Readonly<{ invalid: boolean }>) {
  const form = useForm<Values>({ defaultValues: { password: '' } });
  const { setError } = form;

  React.useEffect(() => {
    if (invalid) {
      setError('password', { type: 'manual', message: 'error' });
    }
  }, [invalid, setError]);

  return (
    <Form {...form}>
      <FormField
        control={form.control}
        name='password'
        render={() => (
          <FormItem>
            <FormSuccessMessage>success text</FormSuccessMessage>
          </FormItem>
        )}
      />
    </Form>
  );
}

describe('FormSuccessMessage', () => {
  it('renders the success message when the field carries no error', () => {
    render(<Harness invalid={false} />);
    expect(screen.getByText('success text')).toBeInTheDocument();
  });

  it('renders nothing while the field carries an error', () => {
    render(<Harness invalid />);
    expect(screen.queryByText('success text')).not.toBeInTheDocument();
  });
});
