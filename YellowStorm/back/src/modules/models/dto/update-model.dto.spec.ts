import { validate } from 'class-validator';
import { UpdateModelDto } from './update-model.dto';

describe('UpdateModelDto', () => {
  it.each(['chat_completions', 'responses'])('accepts conversation API %s', async (conversationApi) => {
    await expect(validate(Object.assign(new UpdateModelDto(), { conversationApi }))).resolves.toHaveLength(0);
  });

  it.each(['completion', '', true, 3, null])('rejects invalid conversation API %p', async (conversationApi) => {
    expect(await validate(Object.assign(new UpdateModelDto(), { conversationApi }))).not.toHaveLength(0);
  });

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
