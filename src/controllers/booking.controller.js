const {
  createBooking,
  listUserBookings,
  getUserBooking,
  changeBookingSlot
} = require("../services/booking.service");

async function create(req, res, next) {
  try {
    const { slotId, doseNumber } = req.body;

    const { booking, slot } = await createBooking(
      req.auth.id,
      slotId,
      doseNumber === undefined ? undefined : Number(doseNumber)
    );

    return res.status(201).json({
      success: true,
      message: `Dose ${booking.doseNumber} registered for ${slot.date} ${slot.startTime} - ${slot.endTime}`,
      data: {
        booking: booking.toPublicJSON(),
        slot: {
          id: slot._id,
          date: slot.date,
          startTime: slot.startTime,
          endTime: slot.endTime,
          capacity: slot.capacity,
          bookedCount: slot.bookedCount,
          availableDoses: slot.capacity - slot.bookedCount
        }
      }
    });
  } catch (error) {
    return next(error);
  }
}

async function list(req, res, next) {
  try {
    const bookings = await listUserBookings(req.auth.id);

    return res.status(200).json({
      success: true,
      data: { total: bookings.length, bookings }
    });
  } catch (error) {
    return next(error);
  }
}

async function getOne(req, res, next) {
  try {
    const booking = await getUserBooking(req.auth.id, req.params.bookingId);

    return res.status(200).json({ success: true, data: { booking } });
  } catch (error) {
    return next(error);
  }
}

async function update(req, res, next) {
  try {
    const result = await changeBookingSlot(
      req.auth.id,
      req.params.bookingId,
      req.body.slotId
    );

    return res.status(200).json({
      success: true,
      message: `Booking moved to ${result.newSlot.date} ${result.newSlot.startTime} - ${result.newSlot.endTime}`,
      data: {
        booking: result.booking.toPublicJSON(),
        previousSlot: {
          id: result.releasedSlot._id,
          date: result.releasedSlot.date,
          startTime: result.releasedSlot.startTime,
          bookedCount: result.releasedSlot.bookedCount,
          availableDoses:
            result.releasedSlot.capacity - result.releasedSlot.bookedCount
        },
        newSlot: {
          id: result.newSlot._id,
          date: result.newSlot.date,
          startTime: result.newSlot.startTime,
          endTime: result.newSlot.endTime,
          bookedCount: result.newSlot.bookedCount,
          availableDoses: result.newSlot.capacity - result.newSlot.bookedCount
        }
      }
    });
  } catch (error) {
    return next(error);
  }
}

module.exports = { create, list, getOne, update };
