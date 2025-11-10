
"use client";

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useForm, type SubmitHandler, Controller, type FieldName } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { UserPlus, ArrowLeft, User, Phone, Lock, CreditCard, Car, ImageIcon, CalendarDays, Palette, Hash, Loader2, Mail } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { IconInput } from '@/components/shared/icon-input';
import { VEHICLE_TYPES } from '@/lib/constants';
import { cn } from '@/lib/utils';
import { createDriverAccount, type UserProfile, doesPhoneOrEmailExist } from '@/lib/firebaseService';
import { Progress } from '@/components/ui/progress';
import { Checkbox } from '@/components/ui/checkbox';


const fileValidation = z.any()
  .refine((files) => files?.length == 1, 'الصورة مطلوبة.')
  .refine((files) => files?.[0]?.size <= 5000000, `الحد الأقصى لحجم الملف 5 ميغابايت.`);

const signUpSchema = z.object({
  fullName: z.string().min(3, { message: "الاسم الكامل مطلوب." }),
  phone: z.string().regex(/^07[789]\d{7}$/, { message: "رقم هاتف أردني غير صالح (مثال: 0791234567)." }),
  secondaryPhone: z.string().regex(/^07[789]\d{7}$/, { message: "رقم هاتف أردني غير صالح." }).optional().or(z.literal('')),
  email: z.string().email({ message: "الرجاء إدخال بريد إلكتروني صالح." }),
  password: z.string().min(6, { message: "كلمة المرور يجب أن تكون 6 أحرف على الأقل." }),
  
  idNumber: z.string().regex(/^\d{10}$/, { message: "الرقم الوطني يجب أن يتكون من 10 أرقام." }),
  idPhoto: fileValidation,
  licenseNumber: z.string().regex(/^\d{8}$/, { message: "رقم الرخضة يجب ان يتكون من 8 ارقام" }),
  licenseExpiry: z.string().min(1, { message: "تاريخ انتهاء الرخصة مطلوب." }),
  licensePhoto: fileValidation,

  vehicleType: z.string().min(1, { message: "نوع المركبة مطلوب." }),
  otherVehicleType: z.string().optional(),
  year: z.string().min(4, { message: "سنة الصنع مطلوبة (مثال: 2020)." }).max(4),
  color: z.string().min(1, { message: "لون المركبة مطلوب." }),
  plateNumber: z.string().min(1, { message: "رقم اللوحة مطلوب." }),
  vehiclePhoto: fileValidation,
  termsAccepted: z.boolean().refine(val => val === true, {
    message: "يجب الموافقة على الشروط والأحكام للمتابعة.",
  }),
}).refine(data => {
    if (data.vehicleType === 'other') {
        return !!data.otherVehicleType && data.otherVehicleType.length > 0;
    }
    return true;
}, {
    message: "الرجاء تحديد نوع المركبة الآخر",
    path: ['otherVehicleType'],
});

type SignUpFormValues = z.infer<typeof signUpSchema>;

const steps: { title: string; fields: FieldName<SignUpFormValues>[] }[] = [
    { title: 'البيانات الأساسية', fields: ['fullName', 'phone', 'secondaryPhone', 'email', 'password'] },
    { title: 'معلومات السائق', fields: ['idPhoto', 'idNumber', 'licenseNumber', 'licenseExpiry', 'licensePhoto'] },
    { title: 'بيانات المركبة', fields: ['vehicleType', 'otherVehicleType', 'year', 'color', 'plateNumber', 'vehiclePhoto', 'termsAccepted'] }
];

async function uploadFileToImageKit(file: File | undefined | null): Promise<string> {
  if (!file) throw new Error("File is missing for upload");
  try {
    const authResponse = await fetch('/api/imagekit-auth');
    if (!authResponse.ok) {
      throw new Error('Failed to get ImageKit auth params');
    }
    const authParams = await authResponse.json();

    const formData = new FormData();
    formData.append('file', file);
    formData.append('fileName', file.name);
    formData.append('publicKey', "public_IfRvA+ieL0CZzBuuO9i9cFceLn8=");
    formData.append('signature', authParams.signature);
    formData.append('expire', authParams.expire);
    formData.append('token', authParams.token);

    const uploadResponse = await fetch('https://upload.imagekit.io/api/v1/files/upload', {
      method: 'POST',
      body: formData,
    });

    if (!uploadResponse.ok) {
      const errorData = await uploadResponse.json();
      console.error('ImageKit Upload Error:', errorData);
      throw new Error(errorData.message || 'ImageKit upload failed');
    }

    const uploadResult = await uploadResponse.json();
    if(!uploadResult.url) throw new Error("ImageKit upload did not return a URL.");
    return uploadResult.url;
  } catch (error) {
    console.error('Error uploading to ImageKit:', error);
    throw error;
  }
}

const FileInput = ({
  label, id, error, register, fieldName, isRequired = false, disabled, accept
}: {
  label: string, id: string, error?: string,
  register: any,
  fieldName: keyof SignUpFormValues,
  isRequired?: boolean,
  disabled?: boolean,
  accept: string,
}) => (
  <div className="space-y-1">
    <Label htmlFor={id}>{label} {isRequired && <span className="text-destructive">*</span>}</Label>
    <Input id={id} type="file" accept={accept} className={cn("pt-2", error ? 'border-destructive' : '')} {...register(fieldName)} disabled={disabled} />
    {error && <p className="mt-1 text-sm text-destructive">{error}</p>}
  </div>
);

export default function SignUpPage() {
  const router = useRouter();
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);

  const { register, handleSubmit, control, trigger, watch, formState: { errors } } = useForm<SignUpFormValues>({
    resolver: zodResolver(signUpSchema),
    mode: 'onChange',
  });

  const watchedVehicleType = watch('vehicleType');

  const handleNextStep = async () => {
    const fieldsToValidate = steps[currentStep].fields;
    const isValid = await trigger(fieldsToValidate);
    if (isValid) {
      setCurrentStep(prev => prev + 1);
    }
  };

  const handlePrevStep = () => {
    setCurrentStep(prev => prev - 1);
  };
  
  const onSubmit: SubmitHandler<SignUpFormValues> = async (data) => {
    setIsLoading(true);

    try {
        const { phoneExists } = await doesPhoneOrEmailExist(data.phone, data.email);
        
        if (phoneExists) {
            toast({ title: "خطأ في التسجيل", description: "رقم الهاتف هذا مسجل بالفعل. يرجى استخدام رقم آخر أو تسجيل الدخول.", variant: "destructive" });
            setIsLoading(false);
            return;
        }

        const [idPhotoUrl, licensePhotoUrl, vehiclePhotoUrl] = await Promise.all([
            uploadFileToImageKit(data.idPhoto?.[0]),
            uploadFileToImageKit(data.licensePhoto?.[0]),
            uploadFileToImageKit(data.vehiclePhoto?.[0]),
        ]);

        const profileData: Omit<UserProfile, 'id' | 'createdAt' | 'updatedAt' | 'status'> = {
            fullName: data.fullName,
            phone: data.phone,
            email: data.email,
            secondaryPhone: data.secondaryPhone || '',
            idNumber: data.idNumber,
            idPhotoUrl: idPhotoUrl,
            licenseNumber: data.licenseNumber,
            licenseExpiry: data.licenseExpiry,
            licensePhotoUrl: licensePhotoUrl,
            vehicleType: data.vehicleType,
            otherVehicleType: data.otherVehicleType,
            vehicleYear: data.year,
            vehicleColor: data.color,
            vehiclePlateNumber: data.plateNumber,
            vehiclePhotosUrl: vehiclePhotoUrl,
            paymentMethods: { cash: true, click: false, clickCode: '' },
            rating: 5,
            tripsCount: 0,
            walletBalance: 0,
        };

        await createDriverAccount(profileData, data.password);

        toast({
            title: "تم استلام طلب التسجيل بنجاح",
            description: "سيتم مراجعة طلبك والموافقة على حسابك في أقرب وقت ممكن.",
        });
        router.push('/auth/signin');

    } catch (error: any) {
        console.error("Signup Error:", error);
        let errorMessage = "حدث خطأ أثناء إنشاء الحساب. الرجاء المحاولة مرة أخرى.";
        if (error?.message?.includes("EMAIL_EXISTS") || error?.code === 'auth/email-already-in-use') {
            errorMessage = "هذا البريد الإلكتروني مسجل بالفعل. يرجى استخدام بريد آخر أو تسجيل الدخول.";
        } else if(error?.message?.includes("File is missing for upload")) {
             errorMessage = "فشل رفع إحدى الصور المطلوبة. يرجى التأكد من رفع جميع الصور.";
        }
        toast({
            title: "خطأ في التسجيل",
            description: errorMessage,
            variant: "destructive",
        });
    } finally {
        setIsLoading(false);
    }
};
  
  const progressValue = useMemo(() => ((currentStep + 1) / steps.length) * 100, [currentStep]);


  return (
    <div className="form-card mb-10 w-full max-w-2xl">
      <div className="mb-4 text-center">
        <h2 className="text-2xl font-bold">إنشاء حساب سائق جديد</h2>
        <p className="text-muted-foreground">{`الخطوة ${currentStep + 1} من ${steps.length}: ${steps[currentStep].title}`}</p>
      </div>
      
      <Progress value={progressValue} className="mb-6 h-2" />

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
        
        {currentStep === 0 && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4">
              <div className="space-y-1">
                  <Label htmlFor="fullName">الاسم الكامل <span className="text-destructive">*</span></Label>
                  <IconInput icon={User} id="fullName" {...register('fullName')} />
                  {errors.fullName && <p className="mt-1 text-sm text-destructive">{errors.fullName.message}</p>}
              </div>
              <div className="space-y-1">
                  <Label htmlFor="phone">رقم الهاتف <span className="text-destructive">*</span></Label>
                  <IconInput icon={Phone} id="phone" type="tel" {...register('phone')} />
                  {errors.phone && <p className="mt-1 text-sm text-destructive">{errors.phone.message}</p>}
              </div>
               <div className="space-y-1">
                  <Label htmlFor="secondaryPhone">رقم هاتف إضافي (اختياري)</Label>
                  <IconInput icon={Phone} id="secondaryPhone" type="tel" {...register('secondaryPhone')} />
                  {errors.secondaryPhone && <p className="mt-1 text-sm text-destructive">{errors.secondaryPhone.message}</p>}
              </div>
              <div className="space-y-1">
                  <Label htmlFor="email">البريد الإلكتروني <span className="text-destructive">*</span></Label>
                  <IconInput icon={Mail} id="email" type="email" {...register('email')} />
                  {errors.email && <p className="mt-1 text-sm text-destructive">{errors.email.message}</p>}
              </div>
              <div className="space-y-1 md:col-span-2">
                  <Label htmlFor="password">كلمة المرور <span className="text-destructive">*</span></Label>
                  <IconInput icon={Lock} id="password" type="password" {...register('password')} />
                  {errors.password && <p className="mt-1 text-sm text-destructive">{errors.password.message}</p>}
              </div>
            </div>
        )}

        {currentStep === 1 && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4">
                <div className="space-y-1">
                  <Label htmlFor="idNumber">الرقم الوطني <span className="text-destructive">*</span></Label>
                  <IconInput icon={CreditCard} id="idNumber" {...register('idNumber')} maxLength={10} />
                  {errors.idNumber && <p className="mt-1 text-sm text-destructive">{errors.idNumber.message}</p>}
                </div>
                 <div className="space-y-1">
                  <Label htmlFor="licenseNumber">رقم الرخصة <span className="text-destructive">*</span></Label>
                  <IconInput icon={CreditCard} id="licenseNumber" {...register('licenseNumber')} maxLength={8} />
                  {errors.licenseNumber && <p className="mt-1 text-sm text-destructive">{errors.licenseNumber.message}</p>}
                </div>
                <div className="space-y-1">
                  <Label htmlFor="licenseExpiry">تاريخ انتهاء الرخصة <span className="text-destructive">*</span></Label>
                  <IconInput icon={CalendarDays} id="licenseExpiry" type="date" {...register('licenseExpiry')} />
                  {errors.licenseExpiry && <p className="mt-1 text-sm text-destructive">{errors.licenseExpiry.message}</p>}
                </div>
                <div></div>
                 <FileInput label="الصورة الشخصية" id="idPhoto" error={errors.idPhoto?.message as string} register={register} fieldName="idPhoto" isRequired={true} accept="image/*" />
                <FileInput label="صورة الرخصة" id="licensePhoto" error={errors.licensePhoto?.message as string} register={register} fieldName="licensePhoto" isRequired={true} accept="image/*"/>
            </div>
        )}

        {currentStep === 2 && (
             <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4">
                 <div className="space-y-1">
                  <Label htmlFor="vehicleType">نوع المركبة <span className="text-destructive">*</span></Label>
                   <Controller
                      control={control}
                      name="vehicleType"
                      render={({ field }) => (
                        <Select onValueChange={field.onChange} defaultValue={field.value}>
                          <SelectTrigger id="vehicleType" className={errors.vehicleType ? 'border-destructive' : ''}>
                            <Car className="me-2 h-4 w-4 text-muted-foreground inline-block" />
                            <SelectValue placeholder="اختر النوع" />
                          </SelectTrigger>
                          <SelectContent>
                            {VEHICLE_TYPES.map(type => (
                              <SelectItem key={type.id} value={type.id}>{type.name}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}
                    />
                  {errors.vehicleType && <p className="mt-1 text-sm text-destructive">{errors.vehicleType.message}</p>}
                </div>

                {watchedVehicleType === 'other' && (
                    <div className="space-y-1">
                        <Label htmlFor="otherVehicleType">الرجاء تحديد النوع <span className="text-destructive">*</span></Label>
                        <IconInput icon={Car} id="otherVehicleType" {...register('otherVehicleType')} />
                        {errors.otherVehicleType && <p className="mt-1 text-sm text-destructive">{errors.otherVehicleType.message}</p>}
                    </div>
                )}

                <div className="space-y-1">
                  <Label htmlFor="year">سنة الصنع <span className="text-destructive">*</span></Label>
                  <IconInput icon={CalendarDays} id="year" type="number" placeholder="YYYY" {...register('year')} />
                  {errors.year && <p className="mt-1 text-sm text-destructive">{errors.year.message}</p>}
                </div>
                <div className="space-y-1">
                  <Label htmlFor="color">اللون <span className="text-destructive">*</span></Label>
                  <IconInput icon={Palette} id="color" {...register('color')} />
                  {errors.color && <p className="mt-1 text-sm text-destructive">{errors.color.message}</p>}
                </div>
                <div className="space-y-1">
                  <Label htmlFor="plateNumber">رقم اللوحة <span className="text-destructive">*</span></Label>
                  <IconInput icon={Hash} id="plateNumber" {...register('plateNumber')} />
                  {errors.plateNumber && <p className="mt-1 text-sm text-destructive">{errors.plateNumber.message}</p>}
                </div>
                <FileInput label="صورة المركبة" id="vehiclePhoto" error={errors.vehiclePhoto?.message as string} register={register} fieldName="vehiclePhoto" isRequired={true} accept="image/*" />
                
                <div className="md:col-span-2 flex items-center space-x-2 space-x-reverse pt-4">
                  <Controller
                    name="termsAccepted"
                    control={control}
                    render={({ field }) => (
                      <Checkbox
                        id="terms"
                        checked={field.value}
                        onCheckedChange={field.onChange}
                      />
                    )}
                  />
                  <div className="grid gap-1.5 leading-none">
                    <label
                      htmlFor="terms"
                      className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                    >
                      أوافق على{" "}
                      <Link href="/terms" target="_blank" className="underline text-primary">
                        الشروط والأحكام
                      </Link>
                    </label>
                    {errors.termsAccepted && <p className="text-sm text-destructive">{errors.termsAccepted.message}</p>}
                  </div>
                </div>

            </div>
        )}


        <div className="mt-8 flex justify-between items-center gap-2">
          <div>
            {currentStep > 0 && (
                <Button type="button" variant="outline" onClick={handlePrevStep} className="px-6">
                السابق
                </Button>
            )}
          </div>
          <div className="flex-grow text-left">
            {currentStep < steps.length - 1 && (
                <Button type="button" onClick={handleNextStep} className="px-6">
                التالي
                </Button>
            )}
            {currentStep === steps.length - 1 && (
                <Button type="submit" className="w-full" disabled={isLoading}>
                {isLoading ? (
                    <Loader2 className="animate-spin" />
                ) : (
                    <>
                    <UserPlus className="ms-2 h-5 w-5" />
                    إنهاء وتقديم الطلب
                    </>
                )}
                </Button>
            )}
           </div>
        </div>

      </form>
      <div className="mt-6 text-center">
        <Link href="/auth/signin" className="text-sm text-primary hover:underline">
          لديك حساب؟ سجل دخول
          <ArrowLeft className="me-1 inline-block h-4 w-4" />
        </Link>
      </div>
    </div>
  );
}
