import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { WIDGET_THEME_PRESETS } from '../constants/widget-default-settings';

const HEX_COLOR_REGEX = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

export class WidgetIdentityDto {
  @ApiPropertyOptional({ maxLength: 120 })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  organizationName?: string;

  @ApiPropertyOptional({ maxLength: 120 })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  assistantTitle?: string;

  @ApiPropertyOptional({ maxLength: 160 })
  @IsOptional()
  @IsString()
  @MaxLength(160)
  assistantSubtitle?: string;

  @ApiPropertyOptional({ enum: ['initials', 'icon', 'none'] })
  @IsOptional()
  @IsEnum(['initials', 'icon', 'none'])
  avatarMode?: 'initials' | 'icon' | 'none';

  @ApiPropertyOptional({ maxLength: 4 })
  @IsOptional()
  @IsString()
  @MaxLength(4)
  avatarInitials?: string;
}

export class WidgetLauncherDto {
  @ApiPropertyOptional({ maxLength: 80 })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  label?: string;

  @ApiPropertyOptional({ maxLength: 40 })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  mobileLabel?: string;

  @ApiPropertyOptional({ enum: ['pill', 'circle'] })
  @IsOptional()
  @IsEnum(['pill', 'circle'])
  variant?: 'pill' | 'circle';

  @ApiPropertyOptional({ enum: ['bottom-right', 'bottom-left'] })
  @IsOptional()
  @IsEnum(['bottom-right', 'bottom-left'])
  position?: 'bottom-right' | 'bottom-left';

  @IsOptional()
  @IsBoolean()
  showUnreadBadge?: boolean;

  @IsOptional()
  @IsBoolean()
  showIntroTooltip?: boolean;

  @ApiPropertyOptional({ maxLength: 160 })
  @IsOptional()
  @IsString()
  @MaxLength(160)
  introTooltipText?: string;
}

export class WidgetThemeColorsDto {
  @IsOptional() @Matches(HEX_COLOR_REGEX) primary?: string;
  @IsOptional() @Matches(HEX_COLOR_REGEX) primaryForeground?: string;
  @IsOptional() @Matches(HEX_COLOR_REGEX) headerBackground?: string;
  @IsOptional() @Matches(HEX_COLOR_REGEX) headerForeground?: string;
  @IsOptional() @Matches(HEX_COLOR_REGEX) launcherBackground?: string;
  @IsOptional() @Matches(HEX_COLOR_REGEX) launcherForeground?: string;
  @IsOptional() @Matches(HEX_COLOR_REGEX) background?: string;
  @IsOptional() @Matches(HEX_COLOR_REGEX) surface?: string;
  @IsOptional() @Matches(HEX_COLOR_REGEX) surfaceAlt?: string;
  @IsOptional() @Matches(HEX_COLOR_REGEX) text?: string;
  @IsOptional() @Matches(HEX_COLOR_REGEX) mutedText?: string;
  @IsOptional() @Matches(HEX_COLOR_REGEX) border?: string;
  @IsOptional() @Matches(HEX_COLOR_REGEX) userBubble?: string;
  @IsOptional() @Matches(HEX_COLOR_REGEX) userBubbleText?: string;
  @IsOptional() @Matches(HEX_COLOR_REGEX) assistantBubble?: string;
  @IsOptional() @Matches(HEX_COLOR_REGEX) assistantBubbleText?: string;
  @IsOptional() @Matches(HEX_COLOR_REGEX) focusRing?: string;
}

export class WidgetThemeDto {
  @ApiPropertyOptional({ enum: WIDGET_THEME_PRESETS })
  @IsOptional()
  @IsEnum(WIDGET_THEME_PRESETS)
  preset?: (typeof WIDGET_THEME_PRESETS)[number];

  @IsOptional()
  @IsBoolean()
  customEnabled?: boolean;

  @ApiPropertyOptional({ type: WidgetThemeColorsDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => WidgetThemeColorsDto)
  colors?: WidgetThemeColorsDto;

  @ApiPropertyOptional({ enum: ['sm', 'md', 'lg', 'xl'] })
  @IsOptional()
  @IsEnum(['sm', 'md', 'lg', 'xl'])
  radius?: 'sm' | 'md' | 'lg' | 'xl';

  @ApiPropertyOptional({ enum: ['comfortable', 'compact'] })
  @IsOptional()
  @IsEnum(['comfortable', 'compact'])
  density?: 'comfortable' | 'compact';
}

export class WidgetLayoutDto {
  @ApiPropertyOptional({ enum: [360, 400, 480] })
  @IsOptional()
  @IsEnum([360, 400, 480])
  desktopWidth?: 360 | 400 | 480;

  @ApiPropertyOptional({ enum: [520, 620, 720] })
  @IsOptional()
  @IsEnum([520, 620, 720])
  desktopHeight?: 520 | 620 | 720;
}

export class WidgetSuggestionDto {
  @IsOptional()
  @IsString()
  @MaxLength(80)
  id?: string;

  @IsString()
  @MaxLength(60)
  label!: string;

  @IsString()
  @MaxLength(5000)
  prompt!: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  icon?: string;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1000)
  sortOrder?: number;
}

export class WidgetFooterLinkDto {
  @IsString()
  @MaxLength(80)
  label!: string;

  @IsUrl({ protocols: ['http', 'https'], require_protocol: true })
  @MaxLength(500)
  url!: string;
}

export class WidgetContentDto {
  @IsOptional()
  @IsString()
  @MaxLength(160)
  greetingTitle?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  greetingBody?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(6)
  @ValidateNested({ each: true })
  @Type(() => WidgetSuggestionDto)
  suggestions?: WidgetSuggestionDto[];

  @IsOptional()
  @IsString()
  @MaxLength(500)
  privacyNotice?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  footerText?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(4)
  @ValidateNested({ each: true })
  @Type(() => WidgetFooterLinkDto)
  footerLinks?: WidgetFooterLinkDto[];
}

export class WidgetLabelsDto {
  @IsOptional()
  @IsObject()
  labels?: Record<string, string>;
}

export class WidgetBehaviorDto {
  @IsOptional() @IsBoolean() defaultOpen?: boolean;
  @IsOptional() @IsBoolean() persistVisitorId?: boolean;
  @IsOptional() @IsBoolean() allowTranscriptCopy?: boolean;
  @IsOptional() @IsBoolean() allowTranscriptDownload?: boolean;
  @IsOptional() @IsBoolean() allowNewConversation?: boolean;
  @IsOptional() @IsBoolean() requirePrivacyNotice?: boolean;
}

export class AgentWidgetSettingsDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1)
  version?: 1;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  appSourceName?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => WidgetIdentityDto)
  identity?: WidgetIdentityDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => WidgetLauncherDto)
  launcher?: WidgetLauncherDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => WidgetThemeDto)
  theme?: WidgetThemeDto;

  @ApiPropertyOptional({ type: WidgetLayoutDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => WidgetLayoutDto)
  layout?: WidgetLayoutDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => WidgetContentDto)
  content?: WidgetContentDto;

  @IsOptional()
  @IsObject()
  labels?: Record<string, string>;

  @IsOptional()
  @ValidateNested()
  @Type(() => WidgetBehaviorDto)
  behavior?: WidgetBehaviorDto;
}
