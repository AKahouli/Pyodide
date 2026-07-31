import { validate } from 'class-validator';
import { UpdateModelDto } from './update-model.dto';

describe('UpdateModelDto', () => {
  it.each([
    [['text']],
    [['text', 'image']],
  ])('accepts supported input modalities: %p', async (inputModalities) => {
    const dto = Object.assign(new UpdateModelDto(), { inputModalities });

    await expect(validate(dto)).resolves.toHaveLength(0);
  });

  it.each([
    [[]],
    [['image']],
    [['text', 'audio']],
    [['text', 'text']],
  ])('rejects invalid input modalities: %p', async (inputModalities) => {
    const dto = Object.assign(new UpdateModelDto(), { inputModalities });

    expect(await validate(dto)).not.toHaveLength(0);
  });
});
