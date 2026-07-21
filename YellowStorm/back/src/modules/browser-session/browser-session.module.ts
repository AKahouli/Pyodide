import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import browserSessionConfig from '../../config/browser-session.config';
import { AuthModule } from '../auth/auth.module';
import { LoggerModule } from '../logger';
import { assertUrlIsSafe } from '../workspace/services/url-safety';
import { BrowserSessionService } from './browser-session.service';
import { BrowserSessionGateway } from './browser-session.gateway';
import { PlaywrightBrowserEngine } from './playwright-browser-engine';
import { BROWSER_ENGINE, URL_SAFETY } from './browser-session.types';

@Module({
  imports: [ConfigModule.forFeature(browserSessionConfig), AuthModule, LoggerModule],
  providers: [
    BrowserSessionService,
    BrowserSessionGateway,
    PlaywrightBrowserEngine,
    { provide: BROWSER_ENGINE, useExisting: PlaywrightBrowserEngine },
    { provide: URL_SAFETY, useValue: assertUrlIsSafe },
  ],
})
export class BrowserSessionModule {}
