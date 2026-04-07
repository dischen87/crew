// Phosphor Icons — Fill weight for bold, playful look
import {
  House,
  Golf,
  Trophy,
  ChatCircleDots,
  Camera,
  DotsThree,
  FlagPennant,
  ArrowLeft,
  PaperPlaneRight,
  MapPin,
  UploadSimple,
  CalendarBlank,
  UsersFour,
  SignOut,
  Star,
  Crown,
  Info,
  Buildings,
  AirplaneTilt,
} from "@phosphor-icons/react";
import React from "react";

type IconProps = React.SVGProps<SVGSVGElement> & { className?: string };

function wrap(Component: any) {
  return function WrappedIcon({ className, ...props }: IconProps) {
    return <Component weight="fill" className={className} {...props} />;
  };
}

export const IconHome = wrap(House);
export const IconGolf = wrap(Golf);
export const IconTrophy = wrap(Trophy);
export const IconChat = wrap(ChatCircleDots);
export const IconCamera = wrap(Camera);
export const IconMenu = wrap(DotsThree);
export const IconFlag = wrap(FlagPennant);
export const IconArrowLeft = wrap(ArrowLeft);
export const IconSend = wrap(PaperPlaneRight);
export const IconMapPin = wrap(MapPin);
export const IconUpload = wrap(UploadSimple);
export const IconCalendar = wrap(CalendarBlank);
export const IconUsers = wrap(UsersFour);
export const IconLogout = wrap(SignOut);
export const IconStar = wrap(Star);
export const IconCrown = wrap(Crown);
export const IconInfo = wrap(Info);
export const IconHotel = wrap(Buildings);
export const IconPlane = wrap(AirplaneTilt);
